import { HttpException, Logger } from '@nestjs/common';
import type { WebLongShortResponse, WebOpenInterestPoint, WebOpenInterestResponse } from '@trade-automation/contracts';
import type { BinanceWeightTracker } from '../../venues/binance/binance-weight.tracker';
import type { FuturesDataClient } from '../../venues/binance/futures-data.client';
import {
  ACCOUNT_RATIO_ENDPOINTS, mapLongShortAccount, mapOpenInterestHist, mapTakerRatio,
  type LongShortAccountRow, type OpenInterestHistRow, type TakerRatioRow,
} from '../../venues/binance/oi-ls.mapper';
import { OI_LS_TTL_MS, windowKey, type TtlCache } from '../../venues/ttl-cache';
import { clipToRetention, joinAtBoundary, periodFor } from './oi-ls-window';
import { WEIGHT_CEILING_1M } from './universe-summary.service';

/**
 * WD-008 step 2 — Binance open interest and the four long-short ratios, read from
 * `/futures/data/*` on demand. Nothing is written to Postgres here.
 *
 * **IB-080 (storage ruling 2026-11-03 S3–S6): the venue first, stored rows only for what it forgot.**
 * The OI/LS poller keeps writing `open_interest_5m` / `long_short_5m`, so a box that has run for
 * months holds more than the venue's ~30 days. A window reaching past retention is answered as:
 *   1. one period P = `periodFor(from, min(to, now))` over the WHOLE window (S4);
 *   2. the venue part exactly as before, asked at P (clipped, cached, refused above the ceiling);
 *   3. the boundary B = the venue's FIRST RETURNED point — not `now − RETENTION_MS`, so the venue's
 *      drifting -1130 edge cannot open a hole; with no venue point, B = min(to, now);
 *   4. the stored part: rows in [from, B), the last per `date_bin(P)` bucket (`oi-ls-stored.repo.ts`);
 *   5. joined without overlap (`joinAtBoundary`); `coverageFrom` / `truncated` keep their meaning over
 *      the joined series (S5). No extra venue call: the venue weight is unchanged.
 * **Without a database, or with no stored row in the window, the answer is exactly WD-009's** —
 * same period, same fields — so a fresh box answers as before.
 * **Known limit (S6, not fixed):** an outage longer than the venue's retention leaves a hole in the
 * stored part that the line bridges; the outage itself is in `collector_gaps`.
 *
 * **Retention.** Binance keeps about 30 days of these series and REFUSES an older window with
 * -1130 rather than returning less (`futures-data.client.ts`). So `from` is clipped to
 * `now − RETENTION_MS` before asking, -1130 still ends a walk cleanly (never a 500), and the answer
 * says how far back it reaches: `coverageFrom` and `truncated`. A window wholly before retention
 * answers no points WITH `truncated: true` — never a bare empty series, which a chart would read as
 * "no open interest", the IB-BUG-011 failure.
 *
 * **Cost.** A `/futures/data` page costs **0 weight** (IB-BUG-030; the WD-008 row said 1) and spends
 * the endpoint's own per-IP limit of 1000 requests / 5 min; the venue sends no `x-mbx-used-weight-1m`
 * header, and `FuturesDataClient` records it at weight 0. A window is read at the finest period that
 * fits in 1 000 rows (`oi-ls-window.ts`): at most 2 pages, so **≤ 2 requests per series**, cached
 * `OI_LS_TTL_MS` (300 s, the venue's own 5-minute period) per (symbol, endpoint, period, window snapped
 * to the period). An instrument page showing OI and all four ratios is therefore ≤ 10 requests per
 * uncached window and 0 for 5 minutes after. Above `WEIGHT_CEILING_1M` (the IP's `/fapi` weight) the
 * read still answers 503 — conservative: it no longer reflects these calls, only a nearly spent IP.
 */
export type LongShortKind = WebLongShortResponse['kind'];

export interface OiLsServiceOptions {
  client: FuturesDataClient;
  cache: TtlCache;
  weight: BinanceWeightTracker;
  /**
   * IB-080: a READ-ONLY port onto the poller's tables, for the part of a window older than the venue
   * keeps (built from `web/series/pg/oi-ls-stored.repo.ts`). Null = venue only. A port rather than a
   * database handle, so this on-demand service still cannot write Postgres (WD-008's guard).
   */
  stored?: OiLsStoredReader | null;
  now?: () => number;
}

/** IB-080: what the service may ask of the stored OI/LS rows — reads only. */
export interface OiLsStoredReader {
  hasOi(symbol: string, fromMs: number, toMs: number): Promise<boolean>;
  oi(symbol: string, fromMs: number, toMs: number, periodMs: number): Promise<Array<{ timeMs: number; oiBase: number; oiQuote: number | null }>>;
  hasLs(symbol: string, kind: string, fromMs: number, toMs: number): Promise<boolean>;
  ls(symbol: string, kind: string, fromMs: number, toMs: number, periodMs: number): Promise<Array<{ timeMs: number; ratio: number }>>;
}

/** The stored half of one series: whether any row exists, and the sampled rows. */
interface StoredSource<P> {
  has(fromMs: number, toMs: number): Promise<boolean>;
  load(fromMs: number, toMs: number, periodMs: number): Promise<P[]>;
}

interface Series<P> {
  points: P[];
  coverageFrom?: number;
  truncated?: boolean;
}

const TAKER_ENDPOINT = 'takerlongshortRatio';

export class OiLsService {
  private readonly logger = new Logger(OiLsService.name);
  private readonly now: () => number;

  constructor(private readonly options: OiLsServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async openInterest(symbol: string, fromMs: number, toMs: number): Promise<WebOpenInterestResponse> {
    const reader = this.options.stored ?? null;
    const source: StoredSource<WebOpenInterestPoint> | null = reader === null ? null : {
      has: (from, to) => reader.hasOi(symbol, from, to),
      load: async (from, to, periodMs) => (await reader.oi(symbol, from, to, periodMs))
        .map((r) => ({ time: sec(r.timeMs), value: r.oiBase, notional: r.oiQuote })),
    };
    const series = await this.series<OpenInterestHistRow, WebOpenInterestPoint>('openInterestHist', symbol, fromMs, toMs, (rows) =>
      mapOpenInterestHist(rows, symbol, 'rest').map((r) => ({
        time: Math.floor(r.ts.getTime() / 1000), value: r.oiBase, notional: r.oiQuote ?? null,
      })), source);
    return { symbol, venue: 'binance', downsampled: false, ...series };
  }

  async longShort(symbol: string, kind: LongShortKind, fromMs: number, toMs: number): Promise<WebLongShortResponse> {
    const reader = this.options.stored ?? null;
    const source: StoredSource<{ time: number; ratio: number }> | null = reader === null ? null : {
      has: (from, to) => reader.hasLs(symbol, kind, from, to),
      load: async (from, to, periodMs) => (await reader.ls(symbol, kind, from, to, periodMs))
        .map((r) => ({ time: sec(r.timeMs), ratio: r.ratio })),
    };
    const series = kind === 'taker'
      ? await this.series<TakerRatioRow, { time: number; ratio: number }>(TAKER_ENDPOINT, symbol, fromMs, toMs, (rows) =>
        ratioPoints(mapTakerRatio(rows, symbol, 'rest')), source)
      : await this.series<LongShortAccountRow, { time: number; ratio: number }>(accountEndpoint(kind), symbol, fromMs, toMs, (rows) =>
        ratioPoints(mapLongShortAccount(rows, symbol, kind, 'rest')), source);
    return { symbol, kind, downsampled: false, ...series };
  }

  private async series<Row extends { timestamp: number }, P extends { time: number }>(
    endpoint: string, symbol: string, fromMs: number, toMs: number, toPoints: (rows: Row[]) => P[],
    source: StoredSource<P> | null,
  ): Promise<Series<P>> {
    const now = this.now();
    const endMs = Math.min(toMs, now);
    // IB-080: the joined path only when the poller has something in the window; otherwise WD-009's
    // answer exactly (same period, same fields) — a fresh box answers as it did before.
    if (source !== null && endMs > fromMs && await source.has(fromMs, endMs)) {
      return this.joined(endpoint, symbol, fromMs, endMs, now, toPoints, source);
    }
    const window = clipToRetention(fromMs, endMs, now);
    if (window.empty) return { points: [], coverageFrom: sec(window.fromMs), truncated: true };

    const { period, periodMs } = periodFor(window.fromMs, window.toMs);
    const points = await this.venuePoints(endpoint, symbol, window, period, periodMs, toPoints);

    // The series starts later than asked when we clipped it, or when the venue had nothing older
    // (its drifting -1130 edge, or a recently listed symbol). Either way: say where it starts.
    const firstMs = points.length > 0 ? points[0].time * 1000 : null;
    const late = firstMs === null || firstMs > window.fromMs + periodMs;
    if (!window.clipped && !late) return { points };
    return { points, coverageFrom: sec(firstMs ?? window.fromMs), truncated: true };
  }

  /** IB-080: venue for what it still has, stored rows before its first point, one period P throughout. */
  private async joined<Row extends { timestamp: number }, P extends { time: number }>(
    endpoint: string, symbol: string, fromMs: number, endMs: number, now: number,
    toPoints: (rows: Row[]) => P[], source: StoredSource<P>,
  ): Promise<Series<P>> {
    const { period, periodMs } = periodFor(fromMs, endMs);
    const window = clipToRetention(fromMs, endMs, now);
    const venue = window.empty ? [] : await this.venuePoints(endpoint, symbol, window, period, periodMs, toPoints);
    const boundaryMs = venue.length > 0 ? venue[0].time * 1000 : endMs;
    const older = boundaryMs > fromMs ? await source.load(fromMs, boundaryMs, periodMs) : [];
    const points = joinAtBoundary(older, venue, boundaryMs);

    const firstMs = points.length > 0 ? points[0].time * 1000 : null;
    const late = firstMs === null || firstMs > fromMs + periodMs;
    return late ? { points, coverageFrom: sec(firstMs ?? fromMs), truncated: true } : { points };
  }

  /** The venue part: clipped window, cached per (symbol, endpoint, period, window), ceiling-guarded. */
  private async venuePoints<Row extends { timestamp: number }, P extends { time: number }>(
    endpoint: string, symbol: string, window: { fromMs: number; toMs: number }, period: string, periodMs: number,
    toPoints: (rows: Row[]) => P[],
  ): Promise<P[]> {
    const key = windowKey({ venue: 'binance', market: 'perp', symbol, tf: `${endpoint}.${period}`, fromMs: window.fromMs, toMs: window.toMs }, periodMs);
    return this.options.cache.getOrLoad(key, OI_LS_TTL_MS, async () => {
      this.refuseAboveCeiling();
      try {
        const rows = await this.options.client.fetchBackward<Row>({ endpoint, symbol, period }, window.fromMs, window.toMs);
        return toPoints(rows);
      } catch (error) {
        this.logger.warn(`Binance ${endpoint} ${symbol} ${period}: ${(error as Error).message}`);
        throw new HttpException(
          { code: 'VENUE_UNAVAILABLE', message: `Binance ${endpoint} for ${symbol} failed: ${(error as Error).message}` },
          502,
        );
      }
    });
  }

  private refuseAboveCeiling(): void {
    if (this.options.weight.used1m(this.now()) > WEIGHT_CEILING_1M) {
      throw new HttpException(
        { code: 'VENUE_UNAVAILABLE', message: `Binance weight above ${WEIGHT_CEILING_1M}/min; not adding to it` },
        503,
      );
    }
  }
}

function accountEndpoint(kind: Exclude<LongShortKind, 'taker'>): string {
  const found = ACCOUNT_RATIO_ENDPOINTS.find((e) => e.kind === kind);
  if (!found) throw new Error(`no endpoint for long-short kind ${kind}`);
  return found.endpoint;
}

function ratioPoints(rows: ReadonlyArray<{ ts: Date; ratio?: number | null }>): Array<{ time: number; ratio: number }> {
  return rows
    .filter((r): r is { ts: Date; ratio: number } => typeof r.ratio === 'number' && Number.isFinite(r.ratio))
    .map((r) => ({ time: Math.floor(r.ts.getTime() / 1000), ratio: r.ratio }));
}

function sec(ms: number): number {
  return Math.floor(ms / 1000);
}

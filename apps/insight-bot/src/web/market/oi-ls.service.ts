import { HttpException, Logger } from '@nestjs/common';
import type { WebLongShortResponse, WebOpenInterestPoint, WebOpenInterestResponse } from '@trade-automation/contracts';
import type { BinanceWeightTracker } from '../../venues/binance/binance-weight.tracker';
import type { FuturesDataClient } from '../../venues/binance/futures-data.client';
import {
  ACCOUNT_RATIO_ENDPOINTS, mapLongShortAccount, mapOpenInterestHist, mapTakerRatio,
  type LongShortAccountRow, type OpenInterestHistRow, type TakerRatioRow,
} from '../../venues/binance/oi-ls.mapper';
import { OI_LS_TTL_MS, windowKey, type TtlCache } from '../../venues/ttl-cache';
import { clipToRetention, periodFor } from './oi-ls-window';
import { WEIGHT_CEILING_1M } from './universe-summary.service';

/**
 * WD-008 step 2 — Binance open interest and the four long-short ratios, read from
 * `/futures/data/*` on demand. Nothing is written to Postgres. Additive: `/series/oi` and
 * `/series/ls` still read the tape until WD-009 switches them.
 *
 * **Retention.** Binance keeps about 30 days of these series and REFUSES an older window with
 * -1130 rather than returning less (`futures-data.client.ts`). So `from` is clipped to
 * `now − RETENTION_MS` before asking, -1130 still ends a walk cleanly (never a 500), and the answer
 * says how far back it reaches: `coverageFrom` and `truncated`. A window wholly before retention
 * answers no points WITH `truncated: true` — never a bare empty series, which a chart would read as
 * "no open interest", the IB-BUG-011 failure.
 *
 * **Weight.** Each `/futures/data` page costs 1 (WD-008 row) and the venue sends no
 * `x-mbx-used-weight-1m` header back, so `FuturesDataClient` counts it into the shared tracker by
 * hand. A window is read at the finest period that fits in 1 000 rows (`oi-ls-window.ts`): at most
 * 2 pages, so **≤ 2 weight per series**, cached `OI_LS_TTL_MS` (300 s, the venue's own 5-minute
 * period) per (symbol, endpoint, period, window snapped to the period). An instrument page showing
 * OI and all four ratios is therefore ≤ 10 weight per uncached window and 0 for 5 minutes after.
 * Above `WEIGHT_CEILING_1M` the read answers 503 rather than adding to the spend.
 */
export type LongShortKind = WebLongShortResponse['kind'];

export interface OiLsServiceOptions {
  client: FuturesDataClient;
  cache: TtlCache;
  weight: BinanceWeightTracker;
  now?: () => number;
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
    const series = await this.series<OpenInterestHistRow, WebOpenInterestPoint>('openInterestHist', symbol, fromMs, toMs, (rows) =>
      mapOpenInterestHist(rows, symbol, 'rest').map((r) => ({
        time: Math.floor(r.ts.getTime() / 1000), value: r.oiBase, notional: r.oiQuote ?? null,
      })),
    );
    return { symbol, venue: 'binance', downsampled: false, ...series };
  }

  async longShort(symbol: string, kind: LongShortKind, fromMs: number, toMs: number): Promise<WebLongShortResponse> {
    const series = kind === 'taker'
      ? await this.series<TakerRatioRow, { time: number; ratio: number }>(TAKER_ENDPOINT, symbol, fromMs, toMs, (rows) =>
        ratioPoints(mapTakerRatio(rows, symbol, 'rest')))
      : await this.series<LongShortAccountRow, { time: number; ratio: number }>(accountEndpoint(kind), symbol, fromMs, toMs, (rows) =>
        ratioPoints(mapLongShortAccount(rows, symbol, kind, 'rest')));
    return { symbol, kind, downsampled: false, ...series };
  }

  private async series<Row extends { timestamp: number }, P extends { time: number }>(
    endpoint: string, symbol: string, fromMs: number, toMs: number, toPoints: (rows: Row[]) => P[],
  ): Promise<Series<P>> {
    const now = this.now();
    const window = clipToRetention(fromMs, Math.min(toMs, now), now);
    if (window.empty) return { points: [], coverageFrom: sec(window.fromMs), truncated: true };

    const { period, periodMs } = periodFor(window.fromMs, window.toMs);
    const key = windowKey({ venue: 'binance', market: 'perp', symbol, tf: `${endpoint}.${period}`, fromMs: window.fromMs, toMs: window.toMs }, periodMs);
    const points = await this.options.cache.getOrLoad(key, OI_LS_TTL_MS, async () => {
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

    // The series starts later than asked when we clipped it, or when the venue had nothing older
    // (its drifting -1130 edge, or a recently listed symbol). Either way: say where it starts.
    const firstMs = points.length > 0 ? points[0].time * 1000 : null;
    const late = firstMs === null || firstMs > window.fromMs + periodMs;
    if (!window.clipped && !late) return { points };
    return { points, coverageFrom: sec(firstMs ?? window.fromMs), truncated: true };
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

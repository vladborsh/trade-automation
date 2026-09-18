import { Logger } from '@nestjs/common';
import { InstrumentId, MetricKind, MetricObservation, MetricSource } from '@trade-automation/contracts';
import { MetricAdapter, TipPrice } from '../metric-adapter.port';
import { tipPriceAt, withDerivedNotional } from '../tip-notional';
import {
  BYBIT_BAR_MS,
  BybitEnvelope,
  BybitMarkPriceKlineResult,
  BybitOpenInterestResult,
  BybitTickersResult,
  isSidednessDrift,
  mapMarkPriceKline,
  mapOpenInterestRow,
  mapTicker,
} from './bybit-metrics.mapper';

/*
 * architecture/aggregate-oi.md §0, §2, §4, §5, §7 — the Bybit linear open-interest leg of an
 * aggregate (SE-AG1). Public endpoints only, no key.
 *
 * RATE BUDGET (§7). Bybit: 600 requests / 5 s per IP across ALL HTTP traffic, no rate-limit
 * headers on public endpoints (the limit cannot be watched, only stayed far below), and a breach
 * returns 403 "access too frequent" plus a >= 10-minute ban of the whole IP — which also kills
 * this live tip. So:
 *   - live: 1 tickers call per METRIC_POLL_INTERVAL_MS (60 s) per symbol = 1 req/min
 *     (0.03 % of the limit); OI, notional and mark come from that one call.
 *   - history: every paginated request is spaced BYBIT_REQUEST_PACING_MS (2 req/s = 10 req / 5 s
 *     = 1.7 % of the limit). The Phase 2 deep crawl for BTCUSDT over 3 y is ~1 577 OI pages +
 *     ~316 mark-kline pages ≈ 1 900 requests ≈ 16 min. A first boot's 30-day warm-up is 44 + 9
 *     pages ≈ 27 s; a normal boot's tail is one page of each.
 *   - HTTP 403/429 throws BybitRateLimitError at once (the pass stops, the crawl resumes next
 *     boot); retCode != 0 on a history page backs off BYBIT_RETCODE_BACKOFF_MS once, then throws.
 *
 * PAGINATION (§5 "Bybit pagination" — the Bug 2 trap). Both /v5/market/open-interest and
 * /v5/market/mark-price-kline return the NEWEST `limit` rows of the requested window, newest
 * first. `walkBackward` requests `[from, cursorEnd]`, stops when a page is short or reaches
 * `from`, else moves `cursorEnd` to the page's oldest stamp − 1. A forward walker would return
 * one page for any window, however wide.
 *
 * JOIN MEASUREMENT (§4, SE-AG1) — see the block at the end of this header, filled in from the
 * live overlap measurement.
 */

/** §7 — 2 requests per second on every paginated history request (see the header). */
export const BYBIT_REQUEST_PACING_MS = 500;
/** §7 — on retCode != 0, wait this long once before giving up on the request. */
export const BYBIT_RETCODE_BACKOFF_MS = 30_000;
/** Documented max `limit` of /v5/market/open-interest. */
export const BYBIT_OI_PAGE_LIMIT = 200;
/** Documented max `limit` of /v5/market/mark-price-kline. */
export const BYBIT_KLINE_PAGE_LIMIT = 1000;
/** §5 — default depth of the Phase 2 crawl (env BYBIT_OI_HISTORY_DAYS). */
export const BYBIT_DEFAULT_HISTORY_DAYS = 1095;

const DAY_MS = 24 * 60 * 60_000;

/** HTTP 403/429 from Bybit: the IP is at (or banned for exceeding) the rate limit. Never retried. */
export class BybitRateLimitError extends Error {
  constructor(readonly status: number, path: string) {
    super(`Bybit ${path} rate-limited (HTTP ${status}); stopping — a breach bans the IP for >= 10 min`);
  }
}

export interface BybitMetricsAdapterOptions {
  /** §5 — how far back the Phase 2 crawl walks. Default BYBIT_DEFAULT_HISTORY_DAYS. */
  historyDays?: number;
  pacingMs?: number;
  retCodeBackoffMs?: number;
  /** §2 drift guard — wired to `metric_sidedness_drift_total{source}`. */
  onSidednessDrift?: (source: InstrumentId) => void;
}

export class BybitMetricsAdapter implements MetricAdapter {
  readonly venue = 'bybit' as const;
  readonly supports: readonly MetricKind[] = ['openInterest'];
  /** §5 — the adapter's own history depth; MetricIngestionService's deepen walks back this far. */
  readonly historyDepthMs: number;
  private readonly logger = new Logger(BybitMetricsAdapter.name);
  private readonly pacingMs: number;
  private readonly retCodeBackoffMs: number;
  private readonly onSidednessDrift?: (source: InstrumentId) => void;
  private readonly driftStreaks = new Set<InstrumentId>();
  private lastRequestAt = 0;

  constructor(
    private readonly restBaseUrl: string,
    options: BybitMetricsAdapterOptions = {},
  ) {
    this.historyDepthMs = (options.historyDays ?? BYBIT_DEFAULT_HISTORY_DAYS) * DAY_MS;
    this.pacingMs = options.pacingMs ?? BYBIT_REQUEST_PACING_MS;
    this.retCodeBackoffMs = options.retCodeBackoffMs ?? BYBIT_RETCODE_BACKOFF_MS;
    this.onSidednessDrift = options.onSidednessDrift;
  }

  /**
   * §4 — `singleOpenInterest` rows over `[from, to]`, ascending, each with a derived notional =
   * single × close of Bybit's own 5-minute mark-price bar ending at the row stamp. A row with no
   * such bar (within TIP_PRICE_MAX_AGE_MS, tip-notional.ts) has no notional — never another
   * venue's price, never an older bar.
   */
  async fetchObservations(
    source: MetricSource,
    metric: MetricKind,
    from: number,
    to: number,
  ): Promise<MetricObservation[]> {
    if (from > to) return [];
    const rows = await this.walkBackward(from, to, BYBIT_OI_PAGE_LIMIT, (end) =>
      this.fetchOpenInterestPage(source, metric, from, end),
    );
    if (rows.length === 0) return [];

    const firstRow = rows[0].time;
    const lastRow = rows[rows.length - 1].time;
    // Bars ending in [firstRow, lastRow] start in [firstRow − 5 m, lastRow − 5 m].
    const marks = await this.walkBackward(firstRow - BYBIT_BAR_MS, lastRow - BYBIT_BAR_MS, BYBIT_KLINE_PAGE_LIMIT, (end) =>
      this.fetchMarkPricePage(source, firstRow - BYBIT_BAR_MS, end),
    );

    return rows.map((o) => {
      const price = tipPriceAt(marks, o.time);
      return price === null ? o : withDerivedNotional(o, price);
    });
  }

  /** §4 live tip — one tickers call: single OI, the venue's own notional, the venue's stamp. */
  async fetchLatest(source: MetricSource, metric: MetricKind): Promise<MetricObservation> {
    const body = await this.request<BybitTickersResult>(
      '/v5/market/tickers',
      { category: 'linear', symbol: source.symbol },
      { paced: false, retryOnRetCode: false },
    );
    const ticker = body.result.list.find((t) => t.symbol === source.symbol);
    if (!ticker) throw new Error(`Bybit tickers: no entry for ${source.symbol}`);
    this.checkSidedness(source.id, ticker.openInterest, ticker.singleOpenInterest);
    return mapTicker(source.id, metric, body.time, ticker);
  }

  /** One OI page: the newest ≤ 200 rows of `[start, end]`. */
  private async fetchOpenInterestPage(
    source: MetricSource,
    metric: MetricKind,
    start: number,
    end: number,
  ): Promise<BackwardPage<MetricObservation>> {
    const body = await this.request<BybitOpenInterestResult>('/v5/market/open-interest', {
      category: 'linear',
      symbol: source.symbol,
      intervalTime: '5min',
      limit: String(BYBIT_OI_PAGE_LIMIT),
      startTime: String(start),
      endTime: String(end),
    });
    const list = body.result.list ?? [];
    for (const row of list) this.checkSidedness(source.id, row.openInterest, row.singleOpenInterest);
    const items = list.map((row) => mapOpenInterestRow(source.id, metric, row));
    return { items, count: list.length, oldest: oldestOf(items.map((o) => o.time)) };
  }

  /** One page of closed mark-price bars (start in `[start, end]`), as close-stamped points. */
  private async fetchMarkPricePage(
    source: MetricSource,
    start: number,
    end: number,
  ): Promise<BackwardPage<TipPrice>> {
    const body = await this.request<BybitMarkPriceKlineResult>('/v5/market/mark-price-kline', {
      category: 'linear',
      symbol: source.symbol,
      interval: '5',
      limit: String(BYBIT_KLINE_PAGE_LIMIT),
      start: String(start),
      end: String(end),
    });
    const list = body.result.list ?? [];
    // A bar still forming at the venue's `time` has no close yet — its "close" is a live price.
    const items = list.map(mapMarkPriceKline).filter((p) => p.time <= body.time);
    // The window and the cursor are in bar START times, the items are stamped at bar close.
    return { items, count: list.length, oldest: oldestOf(list.map((r) => Number(r[0]))) };
  }

  /**
   * §5 — the backward walk shared by both endpoints. `page(end)` returns the newest `limit` rows
   * of `[from, end]` (in any order); pages are prepended so the result is ascending, gapless and
   * de-duplicated. Stops on a short page or once the page's oldest stamp reaches `from`, else
   * `cursorEnd = oldest − 1`.
   */
  private async walkBackward<T extends { time: number }>(
    from: number,
    to: number,
    limit: number,
    page: (end: number) => Promise<BackwardPage<T>>,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursorEnd = to;
    while (cursorEnd >= from) {
      const { items, count, oldest } = await page(cursorEnd);
      if (count === 0 || oldest === null) break;
      const firstKept = out.length > 0 ? out[0].time : Infinity;
      out.unshift(...items.filter((p) => p.time < firstKept).sort((a, b) => a.time - b.time));
      if (count < limit || oldest <= from) break;
      cursorEnd = oldest - 1;
    }
    return out;
  }

  /** §2 drift guard: one counter tick per drifting row, one warn per streak per source. */
  private checkSidedness(source: InstrumentId, openInterest: string, single: string): void {
    if (!isSidednessDrift(openInterest, single)) {
      if (this.driftStreaks.delete(source)) {
        this.logger.log(`Bybit openInterest/singleOpenInterest back at 2 for ${source}`);
      }
      return;
    }
    this.onSidednessDrift?.(source);
    if (!this.driftStreaks.has(source)) {
      this.driftStreaks.add(source);
      this.logger.warn(
        `Bybit sidedness drift for ${source}: openInterest/singleOpenInterest = ${openInterest}/${single}, ` +
          `expected 2 ± 0.001 — the legacy field may have changed meaning (aggregate-oi.md §2)`,
      );
    }
  }

  /**
   * GET a Bybit V5 public endpoint. Paced requests start at least `pacingMs` apart (§7). 403/429
   * → BybitRateLimitError, never retried. retCode != 0 → one backoff, then an error.
   */
  private async request<T>(
    path: string,
    params: Record<string, string>,
    opts: { paced?: boolean; retryOnRetCode?: boolean } = {},
  ): Promise<BybitEnvelope<T>> {
    const paced = opts.paced ?? true;
    const retryOnRetCode = opts.retryOnRetCode ?? true;
    for (let attempt = 0; ; attempt++) {
      if (paced) await this.pace();
      const url = new URL(path, this.restBaseUrl);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const res = await fetch(url);
      if (res.status === 403 || res.status === 429) throw new BybitRateLimitError(res.status, path);
      if (!res.ok) throw new Error(`Bybit ${path} request failed: ${res.status} ${res.statusText}`);
      const body = (await res.json()) as BybitEnvelope<T>;
      if (body.retCode === 0) return body;
      if (!retryOnRetCode || attempt > 0) {
        throw new Error(`Bybit ${path} retCode ${body.retCode}: ${body.retMsg}`);
      }
      this.logger.warn(`Bybit ${path} retCode ${body.retCode} (${body.retMsg}); backing off ${this.retCodeBackoffMs} ms once`);
      await sleep(this.retCodeBackoffMs);
    }
  }

  private async pace(): Promise<void> {
    const wait = this.lastRequestAt + this.pacingMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }
}

/** One page of a backward walk: kept items, the raw row count and the oldest raw stamp. */
interface BackwardPage<T> {
  items: T[];
  count: number;
  oldest: number | null;
}

function oldestOf(stamps: number[]): number | null {
  return stamps.length > 0 ? Math.min(...stamps) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

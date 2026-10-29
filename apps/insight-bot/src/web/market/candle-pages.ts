import { WEB_MAX_CANDLE_BARS, type WebCandle, type WebMarket, type WebTimeframe } from '@trade-automation/contracts';
import { floorToGrid, timeframeMs } from '../series/range';

/**
 * IB-063 — the pure half of `CandlesService`: how a window is cut into venue pages, which part of
 * a page may be remembered, and the cache that remembers it.
 *
 * **Pages are aligned to a fixed grid** (`pageStart = floor(t / span) * span`), not to the
 * caller's `from`. For 1w the grid is shifted to Monday (`floorToGrid`, IB-065): a page that
 * started on a Thursday would cut a week in two. A reader scrolling left asks for windows that start anywhere; aligned pages make
 * the second window that touches a page a cache hit instead of a fresh request.
 */

/** Rows per venue request: `/fapi/v1/klines` allows 1500, spot's `/api/v3/klines` 1000. */
export const PAGE_LIMIT: Readonly<Record<WebMarket, number>> = { perp: 1500, spot: 1000 };

/**
 * The most bars one `/series/candles` request may span. Above it the route answers
 * `400 RANGE_TOO_WIDE` instead of reading the venue.
 *
 * The database path could answer a 90-day 1m window with a stride; the venue cannot, because
 * thinning happens after every page has been bought: 90 days of 1m is 87 perp pages, 870 weight,
 * over a third of the 2400/min budget for one request. One week of 1m (10 080 bars, at most
 * 8 perp pages = 80 weight) is well past anything the dashboard asks for (its widest window is
 * 1 440 bars, `time-range.ts`) and still above `WEB_MAX_POINTS`, so `thin()` keeps its job.
 */
export const MAX_BARS_PER_REQUEST = WEB_MAX_CANDLE_BARS;

/**
 * Pages kept in memory. A full page is 1 000–1 500 `WebCandle`s. Heap per 1 500-row page of
 * synthetic candles, `heapUsed` after `gc()`, 200 pages: 0.28 MB, three runs on 2026-10-29, one
 * occasion (a note, not a rule). So the cap is ~42 MB on a 1 GB box that also runs Postgres.
 */
export const CACHE_MAX_PAGES = 150;

/**
 * A bar counts as closed this long after its close time. A judgement, not a measured venue lag:
 * the kline that closed a moment ago may still be settling its last trade, and a cached bar is
 * never looked at again.
 */
export const SETTLE_MS = 5_000;

export interface PageKey {
  market: WebMarket;
  symbol: string;
  tf: WebTimeframe;
  pageStart: number;
}

export function pageSpanMs(market: WebMarket, tf: WebTimeframe): number {
  return PAGE_LIMIT[market] * timeframeMs(tf);
}

/** The aligned page starts that cover `[fromMs, toMs)`, oldest first. */
export function pagesFor(market: WebMarket, tf: WebTimeframe, fromMs: number, toMs: number): number[] {
  const span = pageSpanMs(market, tf);
  const out: number[] = [];
  for (let start = floorToGrid(fromMs, tf, span); start < toMs; start += span) out.push(start);
  return out;
}

/** Bars a window spans, rounded up: the figure `MAX_BARS_PER_REQUEST` is compared with. */
export function barsIn(tf: WebTimeframe, fromMs: number, toMs: number): number {
  return Math.ceil((toMs - fromMs) / timeframeMs(tf));
}

/** The widest window, in whole days, that `MAX_BARS_PER_REQUEST` allows at `tf` — `maxDays` on the refusal. */
export function maxDaysFor(tf: WebTimeframe): number {
  return Math.max(1, Math.floor((MAX_BARS_PER_REQUEST * timeframeMs(tf)) / 86_400_000));
}

/**
 * Where a page fetched at `fetchedAt` stops being final: the open time of the first bar that had
 * not closed (plus `SETTLE_MS`) by then, or the page end if every bar had. Rows before it never
 * change; rows from it on are the live edge and are not cached.
 */
export function closedUntil(tf: WebTimeframe, pageStart: number, pageEnd: number, fetchedAt: number): number {
  const firstOpen = floorToGrid(fetchedAt - SETTLE_MS, tf);
  return Math.max(pageStart, Math.min(pageEnd, firstOpen));
}

export function pageKey(k: PageKey): string {
  return `${k.market}:${k.symbol}:${k.tf}:${k.pageStart}`;
}

/** What the cache holds for a page: its closed rows, and how far they are final. */
export interface CachedPage {
  rows: readonly WebCandle[];
  /** Exclusive: a window ending at or before this is answered from `rows` alone. */
  closedUntilMs: number;
}

/** A small least-recently-used map: a `Map` keeps insertion order, so the first key is the oldest. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

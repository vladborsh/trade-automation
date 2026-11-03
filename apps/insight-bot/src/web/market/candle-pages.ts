import { familyStats, type CacheStats, type InspectableCache } from '../../ops/cache-registry';
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
 * Pages kept in memory. A full page is 1 000–1 500 candles. Per 1 500-row page of synthetic
 * candles, after `gc()`, 200 pages: as `WebCandle` objects 0.26–0.28 MB of heap (2026-10-29 and
 * 2026-11-04); packed (`packCandles`, IB-096) 0.08 MB of array buffer — three runs each, two
 * occasions, still a note. So the cap is ~12 MB, not ~42 MB. 60 of the slots are the positioning
 * baselines' 1 h pages (30 coins × 2), held so the hourly rebuild does not buy them again.
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

/**
 * IB-066 — the live tail's `limit`: the largest Binance documents at weight 1 on `/fapi/v1/klines`
 * ([1, 100)). A window of fewer bars than this is a tail (`isTail`).
 */
export const TAIL_LIMIT = 99;

/**
 * A window to ask the venue for as itself, at `TAIL_LIMIT`, rather than as pages: fewer bars than
 * that, and reaching a bar that had not closed at `now` — so no cache could have answered it. A
 * short window in the past still goes through the pages and their cache.
 */
export function isTail(tf: WebTimeframe, fromMs: number, toMs: number, now: number): boolean {
  return barsIn(tf, fromMs, toMs) < TAIL_LIMIT && reachesFormingBar(tf, fromMs, toMs, now);
}

/** True when `[fromMs, toMs)` holds a bar that had not closed (and settled) at `now`. */
export function reachesFormingBar(tf: WebTimeframe, fromMs: number, toMs: number, now: number): boolean {
  return closedUntil(tf, fromMs, toMs, now) < toMs;
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

/** What the cache holds for a page: its closed rows, packed, and how far they are final. */
export interface CachedPage {
  /** `packCandles` of the closed rows. */
  packed: Float64Array;
  /** Exclusive: a window ending at or before this is answered from the page alone. */
  closedUntilMs: number;
}

/** Numbers per candle in a packed page: time, open, high, low, close, volume, takerBuyVolume. */
export const CANDLE_FIELDS = 7;

/**
 * IB-096 — a cached page as one `Float64Array` instead of an array of `WebCandle` objects. Each
 * object costs a header, seven slots and a boxed heap number for every non-integer price; packed,
 * a candle is 56 bytes. The owner's ruling (2026-11-03) is memory over latency, and these pages
 * are the one cache that cannot be shrunk by count or TTL without buying the page from Binance
 * again (10 weight each) — so they are shrunk by representation. Reads unpack into fresh objects,
 * which live only as long as the request.
 * A null `takerBuyVolume` is stored as NaN and read back as null.
 */
export function packCandles(rows: readonly WebCandle[]): Float64Array {
  const out = new Float64Array(rows.length * CANDLE_FIELDS);
  rows.forEach((r, i) => {
    out.set([r.time, r.open, r.high, r.low, r.close, r.volume, r.takerBuyVolume ?? Number.NaN], i * CANDLE_FIELDS);
  });
  return out;
}

export function unpackCandles(packed: Float64Array): WebCandle[] {
  const out: WebCandle[] = [];
  for (let o = 0; o < packed.length; o += CANDLE_FIELDS) {
    const taker = packed[o + 6] as number;
    out.push({
      time: packed[o] as number, open: packed[o + 1] as number, high: packed[o + 2] as number,
      low: packed[o + 3] as number, close: packed[o + 4] as number, volume: packed[o + 5] as number,
      takerBuyVolume: Number.isNaN(taker) ? null : taker,
    });
  }
  return out;
}

/** A small least-recently-used map: a `Map` keeps insertion order, so the first key is the oldest. */
export class LruCache<V> implements InspectableCache {
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

  /** IB-096: entries per key family, for `/metrics`. */
  stats(): CacheStats[] {
    return familyStats(this.map.entries());
  }
}

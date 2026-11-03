import type { BinanceRestKline } from '@trade-automation/binance-client';

/**
 * IB-097 (architecture/storage-ruling-2026-11-03.md S8): the price behind a news reaction, from
 * Binance 1m klines fetched on demand instead of the `candles_1m` tape, which nothing writes since
 * WD-010.
 *
 * Pure. `closeAtOrBefore` and `windowCoverage` keep **the semantics of the SQL reads they replace**
 * (`db/pg/reaction-reads.ts` before IB-097), now over the bars one request returned:
 * - the price at an instant is the close of the LAST bar whose open time is ≤ that instant. It is
 *   never the bar after, or the "before" price would already contain part of the move;
 * - coverage counts the bars whose open time is in `[from, to)` against the window's minutes, and a
 *   zero-width window is never "covered".
 *
 * **Only closed bars.** The tape held only closed klines (the collector dropped `k.x === false`).
 * A REST answer includes the bar still forming, whose "close" is the current price. `closedBars`
 * drops it, so a 4h horizon read at minute 240 cannot price itself from a live tick.
 *
 * **One request per measurement**, `/fapi/v1/klines` interval 1m:
 * - `startTime` = the start of the minute containing `window.from` (the anchor bar);
 * - `endTime` = `window.to`;
 * - `limit` = minutes in the window + 1.
 *
 * One difference from the SQL, which had no lower bound: when the venue does not return the anchor
 * bar, the reaction refuses `no_price_at_anchor` instead of reaching further back. Binance publishes
 * a 1m kline for every minute, traded or not, so the difference only shows on a venue fault, and
 * refusing is the right answer then.
 *
 * **Weight, from the Binance docs (not measured):** `/fapi/v1/klines` costs 1 for `limit` in
 * [1, 100), 2 for [100, 500), 5 for [500, 1000] and 10 above. So 15m (16 bars) and 1h (61 bars)
 * cost 1 each and 4h (241 bars) costs 2: 4 per tagged symbol of an article over all three horizons.
 * (Storage ruling S8 and the IB-097 row say 1h costs 2 and the total is 5; 61 < 100 makes it 1 by
 * the same documented steps.) A pass makes at most `MAX_VENUE_CALLS_PER_PASS` (100) calls every
 * 5 minutes, at most 2 each, so at most 200 weight per 5 minutes in the worst case: under 2 % of the
 * 2 400/min budget averaged, and 200 in a single minute at the burst.
 */

const MINUTE_MS = 60_000;

/** IB-097 (4): the ceiling on venue requests in one reaction pass; the rest waits for the next tick. */
export const MAX_VENUE_CALLS_PER_PASS = 100;

export interface ReactionBar {
  openTime: number;
  closeTime: number;
  close: number;
}

export interface KlinesRequest {
  startTime: number;
  endTime: number;
  limit: number;
}

/** The one request a measurement makes, from its window. */
export function klinesRequest(window: { from: Date; to: Date }): KlinesRequest {
  const startTime = Math.floor(window.from.getTime() / MINUTE_MS) * MINUTE_MS;
  return { startTime, endTime: window.to.getTime(), limit: windowMinutes(window.from, window.to) + 1 };
}

/** Binance's documented weight of `/fapi/v1/klines` at this `limit`. */
export function klinesWeight(limit: number): number {
  if (limit < 100) return 1;
  if (limit < 500) return 2;
  if (limit <= 1000) return 5;
  return 10;
}

/**
 * The fields a reaction needs, from the venue's tuples. A row with an unparseable time or close is
 * dropped rather than read as 0: a zero close would become a -100 % "reaction".
 */
export function barsFromKlines(rows: readonly BinanceRestKline[]): ReactionBar[] {
  const bars: ReactionBar[] = [];
  for (const row of rows) {
    const openTime = Number(row[0]);
    const closeTime = Number(row[6]);
    const close = Number(row[4]);
    if (Number.isFinite(openTime) && Number.isFinite(closeTime) && Number.isFinite(close) && close > 0) {
      bars.push({ openTime, closeTime, close });
    }
  }
  return bars;
}

/** The bars that had closed by `now`, as the tape held them. The forming bar is not a price. */
export function closedBars(bars: readonly ReactionBar[], now: number): ReactionBar[] {
  return bars.filter((bar) => bar.closeTime < now);
}

/** The close of the last bar opened at or before `at`; null when there is none. */
export function closeAtOrBefore(bars: readonly ReactionBar[], at: Date): number | null {
  const limit = at.getTime();
  let best: ReactionBar | null = null;
  for (const bar of bars) {
    if (bar.openTime <= limit && (best === null || bar.openTime > best.openTime)) best = bar;
  }
  return best === null ? null : best.close;
}

export interface WindowCoverage {
  /** Distinct bars inside `[from, to)`. */
  present: number;
  /** One per minute of the window. */
  expected: number;
  covered: boolean;
}

/** Whether the series is whole across `[from, to)`: one bar per minute. */
export function windowCoverage(bars: readonly ReactionBar[], from: Date, to: Date): WindowCoverage {
  const expected = windowMinutes(from, to);
  const lo = from.getTime();
  const hi = to.getTime();
  const present = new Set(bars.filter((b) => b.openTime >= lo && b.openTime < hi).map((b) => b.openTime)).size;
  return { present, expected, covered: expected > 0 && present >= expected };
}

function windowMinutes(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MINUTE_MS));
}

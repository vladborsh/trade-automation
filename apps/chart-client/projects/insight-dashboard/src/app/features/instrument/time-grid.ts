/**
 * Every pane of the instrument chart on the candles' time grid (2026-10-24 bug report: "candles
 * shown with gaps").
 *
 * The five panes share ONE time scale, and lightweight-charts gives every distinct time of every
 * series a slot of its own on it. Open interest and long/short arrive every 5 minutes, funding
 * steps had a point one second before each settlement, the predicted rate carries the venue's own
 * millisecond: on a 1h chart that is twelve slots per candle, so the candles drew as sparse
 * sticks with empty space between them. Snapping each series onto the candle grid, last reading
 * in a bar winning, leaves one slot per bar however many series there are.
 */

const TIMEFRAME_SECONDS: Record<string, number> = { '1m': 60, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400 };

/** A timeframe's bar length in seconds; 60 for anything unknown, the finest the page offers. */
export function barSeconds(timeframe: string): number {
  return TIMEFRAME_SECONDS[timeframe] ?? 60;
}

/** The start of the bar `timeSec` falls in. */
export function snapTime(timeSec: number, stepSec: number): number {
  return Math.floor(timeSec / stepSec) * stepSec;
}

/**
 * Points moved onto the bar they fall in, the LAST reading of a bar kept. Last rather than mean:
 * these are snapshots (open interest, a ratio, a rate), and a bar's close is its latest reading,
 * the same convention as the candle's own close. Output is strictly ascending.
 */
export function snapToGrid<T extends { time: number }>(points: readonly T[], stepSec: number): T[] {
  const byBar = new Map<number, T>();
  for (const p of [...points].sort((a, b) => a.time - b.time)) {
    const time = snapTime(p.time, stepSec);
    byBar.set(time, { ...p, time });
  }
  return [...byBar.values()].sort((a, b) => a.time - b.time);
}

/**
 * The bars of `times` (ascending candle times) that START inside `[fromSec, toSec)`, as the first
 * and last such time; null when none does. Every indicator that spans a period (a day, a session)
 * is placed on these, so it lands on real candle slots: a time the candles lack would add a slot
 * of its own to the shared time scale and open a gap between candles.
 */
export function barsWithin(times: readonly number[], fromSec: number, toSec: number): { first: number; last: number } | null {
  const i = lowerBound(times, fromSec);
  if (i >= times.length || times[i] >= toSec) return null;
  const j = lowerBound(times, toSec) - 1;
  return { first: times[i], last: times[j] };
}

/** The index of the first time ≥ `t` (times.length when there is none). */
function lowerBound(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

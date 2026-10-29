import { barsWithin } from './time-grid';

/**
 * Day separators: a vertical line at every UTC midnight, on every pane (2026-10-24, §13).
 *
 * Pure: which bars a line goes on. Drawing is `time-marks.primitive.ts`. Each line sits on the
 * FIRST bar of its UTC day rather than at midnight itself, so it lands on a real candle slot even
 * when the midnight bar is missing (time-grid.ts: an off-grid time opens a gap between candles).
 */

const DAY_SEC = 86_400;

/** Off on 1d, where every bar is a day and a line per bar is noise, and on 1w, where a day is inside a bar. */
export function showsDaySeparators(timeframe: string): boolean {
  return timeframe !== '1d' && timeframe !== '1w';
}

/**
 * The first bar of each UTC day in `times` (ascending candle times), the very first day excepted:
 * a separator separates a day from the one before it, and the window's left edge has nothing
 * before it on screen.
 */
export function daySeparatorTimes(times: readonly number[]): number[] {
  if (times.length === 0) return [];
  const out: number[] = [];
  const firstDay = Math.floor(times[0] / DAY_SEC) * DAY_SEC;
  for (let day = firstDay + DAY_SEC; day <= times[times.length - 1]; day += DAY_SEC) {
    const bars = barsWithin(times, day, day + DAY_SEC);
    if (bars) out.push(bars.first);
  }
  return out;
}

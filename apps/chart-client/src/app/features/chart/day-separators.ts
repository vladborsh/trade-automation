import type { Timeframe } from '@trade-automation/contracts';
import { nyDayNumber } from './ny-time';

/** §12.3 — day separators on intraday timeframes up to 1h only; hidden on 4h and 1d. */
export function showsDaySeparators(tf: Timeframe): boolean {
  return tf === '1m' || tf === '5m' || tf === '15m' || tf === '1h';
}

/**
 * §12.3 — every index `i > 0` whose NY calendar day differs from bar `i − 1`'s. Per data
 * transition, not per calendar midnight: a weekend / market-closed gap yields one boundary at the
 * first bar after it, and a 23 h / 25 h DST day still yields exactly one. `timesSec` is UTC epoch
 * seconds, ascending.
 */
export function nyDayBoundaryIndices(timesSec: readonly number[]): number[] {
  const out: number[] = [];
  let prevDay = timesSec.length > 0 ? nyDayNumber(timesSec[0]) : 0;
  for (let i = 1; i < timesSec.length; i++) {
    const day = nyDayNumber(timesSec[i]);
    if (day !== prevDay) {
      out.push(i);
      prevDay = day;
    }
  }
  return out;
}

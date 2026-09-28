import { WINDOWS } from '../feature-keys';

/**
 * IB-015 — Wilder's ATR(14) on `candles_agg` (§8.2).
 *
 * **Wilder's smoothing, not a simple mean.** The two differ for the whole life of the series,
 * not just at the start, and ATR feeds P3's stop distance and the `failed_highs` tolerance —
 * so a "close enough" average would move a stop. The seed is the simple mean of the first
 * `period` true ranges, then `atr = (prev·(period−1) + tr) / period`, which is the definition
 * every charting package implements and the one a reader comparing our number to TradingView
 * will expect.
 *
 * The first true range uses only `high − low`, because there is no previous close to gap from.
 */

export interface Bar {
  high: number;
  low: number;
  close: number;
}

/** True range: the largest of the bar's own range and its two gaps from the previous close. */
export function trueRange(bar: Bar, previousClose: number | null): number {
  const range = bar.high - bar.low;
  if (previousClose === null) return range;
  return Math.max(range, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
}

export function trueRanges(bars: readonly Bar[]): number[] {
  return bars.map((bar, i) => trueRange(bar, i === 0 ? null : (bars[i - 1] as Bar).close));
}

/**
 * Wilder ATR over `bars` (oldest first), or `null` when there are fewer than `period + 1` bars.
 *
 * `period + 1`, not `period`: the first bar only contributes a seed true range with no previous
 * close, so a 14-period ATR wants 15 bars to be the thing it claims to be. Returning a number
 * off 14 would be a different, slightly wider statistic wearing the same name.
 */
export function wilderAtr(bars: readonly Bar[], period: number = WINDOWS.atrPeriod): number | null {
  if (bars.length < period + 1) return null;

  const tr = trueRanges(bars);
  let atr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  for (let i = period + 1; i < tr.length; i++) {
    atr = (atr * (period - 1) + (tr[i] as number)) / period;
  }
  return atr;
}

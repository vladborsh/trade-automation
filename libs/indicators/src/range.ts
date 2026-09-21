import { Candle } from '@trade-automation/contracts';

export interface RangeResult {
  rangeTop?: number;
  rangeBottom?: number;
  inDiscount: boolean;
}

/**
 * knowledge/vwap-band-reversal-ict.md §5 (cmc-bot-main/src/indicator/tools/range.indicator.ts)
 * — Researcher D-06: a plain rolling `length`-bar high/low window, computed over the `length`
 * bars immediately BEFORE the last bar of `bars` (the bot's slide advances the window before
 * appending the current bar). Requires bars.length >= length + 1; `inDiscount` is false
 * (rather than a NaN-comparison artifact) when the range is undefined.
 */
export function computeRange(bars: readonly Candle[], length: number): RangeResult {
  const n = bars.length;
  if (n < length + 1) return { inDiscount: false };

  const windowBars = bars.slice(n - 1 - length, n - 1);
  const top = Math.max(...windowBars.map((b) => b.high));
  const bottom = Math.min(...windowBars.map((b) => b.low));
  const middle = (top + bottom) / 2;
  const inDiscount = bars[n - 1].close < middle;

  return { rangeTop: top, rangeBottom: bottom, inDiscount };
}

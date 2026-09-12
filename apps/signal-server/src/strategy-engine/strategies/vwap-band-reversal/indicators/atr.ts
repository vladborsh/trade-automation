import { Candle } from '@trade-automation/contracts';

/**
 * knowledge/vwap-band-reversal-ict.md §7 (cmc-bot-main/src/indicator/tools/atr.indicator.ts,
 * last-value form) — ATR(length) = arithmetic mean of the true range over the last `length`
 * bars of `bars` (k = n-length .. n-1). Requires bars.length >= length + 1 (a true range needs
 * a previous close); undefined otherwise, matching the bot's empty-array output for a short
 * window.
 */
export function computeAtr(bars: readonly Candle[], length: number): number | undefined {
  const n = bars.length;
  if (n < length + 1) return undefined;

  let sum = 0;
  for (let k = n - length; k < n; k++) {
    const highLow = bars[k].high - bars[k].low;
    const highClose = Math.abs(bars[k].high - bars[k - 1].close);
    const lowClose = Math.abs(bars[k].low - bars[k - 1].close);
    sum += Math.max(highLow, highClose, lowClose);
  }
  return sum / length;
}

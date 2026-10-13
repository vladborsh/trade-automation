import { Candle } from '@trade-automation/contracts';

/**
 * knowledge/vwap-band-reversal-ict.md §7 (cmc-bot-main/src/indicator/tools/atr.indicator.ts,
 * last-value form) — ATR(length) = arithmetic mean of the true range over the last `length`
 * bars of `bars` (k = n-length .. n-1). Requires bars.length >= length + 1 (a true range needs
 * a previous close); undefined otherwise, matching the bot's empty-array output for a short
 * window.
 *
 * **This is NOT Wilder's ATR, and the name does not say so.** Wilder smooths —
 * `atr = (atr_prev · (n − 1) + tr) / n` — so every earlier bar stays in the number with a
 * decaying weight. This one is a flat mean of the last `length` true ranges, so a bar leaves the
 * number entirely once it falls out of the window. They agree on flat data and diverge on
 * trending data, and neither looks wrong on a chart: on one worked 7-bar series with a single
 * violent bar they are **9× apart** (`apps/insight-bot/test/features/wilder-atr.spec.ts`).
 *
 * A Wilder implementation exists at `apps/insight-bot/src/features/math/wilder-atr.ts`, written
 * for IB-015 because design §8.2 requires Wilder's specifically. **It is not importable from
 * here today** — insight-bot deliberately does not depend on `libs/indicators`, and that
 * coupling is a bigger decision than a convenient import.
 *
 * ---------------------------------------------------------------------------------------------
 * **BUG-024, ANSWERED 2026-10-13: this function is CORRECT. Only its name misled.**
 *
 * The question was whether `vwap-band-reversal` meant Wilder when its spec said "ATR". It did
 * not. `cmc-bot-main/src/indicator/tools/atr.indicator.ts` — the original the plug-in is a
 * *faithful* port of — computes
 *
 *     trueRanges.slice(i - length, i).reduce((a, b) => a + b, 0) / length
 *
 * which is the arithmetic mean of true range, exactly what this function does. **Switching this
 * to Wilder would make the port unfaithful**: it would silently become a different strategy from
 * the one under research, and every result gathered for it would describe something else.
 *
 * So the two implementations are **both wanted and must stay apart** — they are different
 * statistics, not a duplication to consolidate. Measured on 30 Binance perp symbols, 1h,
 * length 20 with an 80-bar warm-up: `ATR_wilder / ATR_mean` has a median of 1.02 (per-symbol
 * medians 0.97–1.06) but ranges 0.73–2.09 on individual bars. They agree when it is calm and
 * diverge hardest when volatility spikes.
 *
 * The misleading name is left alone deliberately: renaming is cosmetic, the pause is on, and a
 * reader who arrives here now gets the deciding fact instead of the open question.
 * ---------------------------------------------------------------------------------------------
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

/**
 * IB-015 — Wilder's ATR(14), as §8.2 specifies it.
 *
 * **`libs/indicators` already exports `computeAtr` and `atrSeries` and NEITHER is this.** Both are
 * the arithmetic mean of true range over the last N bars. Wilder's is a smoothed average,
 * `atr = (atr_prev · (n − 1) + tr) / n`, which carries every earlier bar with a decaying weight.
 * The two agree on flat data and diverge on trending data, and neither looks wrong on a chart —
 * so reusing the existing helper would have produced three quietly wrong keys (`atr.1h.14`,
 * `atr.4h.14`, `atr.1d.14`), plus `structure.failed_highs_24h`, which is defined as a distance of
 * 0.5·ATR, plus the `vol` regime band in §8.3. That is a feature that moves a signal while
 * looking like an opinion, which is the whole reason this task exists.
 *
 * The recurrence is not invented here either: it is the same shape already used for the average
 * gain/loss in `libs/indicators/src/rsi.ts`, which is Wilder's too.
 */

export interface AtrBar {
  high: number;
  low: number;
  /** The previous bar's close is what makes a gap part of the range, so closes are required. */
  close: number;
}

/**
 * True range of `bar` against the previous close.
 *
 * The first bar of a series has no previous close, and `high − low` is the only honest answer
 * there — not zero, and not a gap measured against itself.
 */
export function trueRange(bar: AtrBar, previousClose: number | null): number {
  const hl = bar.high - bar.low;
  if (previousClose === null) return hl;
  return Math.max(hl, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
}

/**
 * Wilder ATR over `length` periods, or `null` when there is not enough history.
 *
 * Needs `length + 1` bars: `length` true ranges each measured against a previous close. Returning
 * a number from fewer would be an ATR of a different period wearing this one's name — §8.2 fixes
 * the window, so a short window is "not computable", not "close enough".
 *
 * Bars must be in ascending time order; the caller owns that, because this function cannot tell
 * a mis-sorted series from a volatile one.
 */
export function wilderAtr(bars: readonly AtrBar[], length: number): number | null {
  if (length < 1) throw new Error(`wilderAtr: length must be at least 1, got ${length}`);
  if (bars.length < length + 1) return null;

  const trs: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    trs.push(trueRange(bars[i] as AtrBar, (bars[i - 1] as AtrBar).close));
  }

  // seed: the simple mean of the first `length` true ranges (Wilder's own seeding)
  let atr = 0;
  for (let i = 0; i < length; i += 1) atr += trs[i] as number;
  atr /= length;

  // then the recurrence, over every remaining true range
  for (let i = length; i < trs.length; i += 1) {
    atr = (atr * (length - 1) + (trs[i] as number)) / length;
  }
  return atr;
}

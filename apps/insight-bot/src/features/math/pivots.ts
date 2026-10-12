/**
 * IB-015 — 3-bar pivots, the basis of §8.2's `structure.*` keys. Nothing like this exists in the
 * monorepo; `fvg.ts` is the nearest 3-bar pattern and is a different question.
 *
 * A pivot high is a bar strictly higher than the bar on each side. **Strictly**, on both sides:
 * with `>=` a flat run of equal highs would mark every bar in it as a pivot, and the swing
 * extreme would then be "the most recent of several identical highs", which is an arbitrary
 * choice dressed as a measurement.
 *
 * The first and last bar can never be pivots — they have no neighbour on one side. That is a
 * refusal, not an omission: a 12-hour window of 15m bars has 48 bars and at most 46 pivots, and
 * a caller that wants the window's extreme must say whether it means the pivot extreme or the
 * raw extreme. §8.2 says pivot-based, so these return pivots.
 */

export interface PivotBar {
  /** Epoch ms of the bar's open, carried through so a caller can locate the swing in time. */
  time: number;
  high: number;
  low: number;
}

export interface Pivot {
  time: number;
  price: number;
  index: number;
}

/** Bars strictly higher than both neighbours, in time order. */
export function pivotHighs(bars: readonly PivotBar[]): Pivot[] {
  const out: Pivot[] = [];
  for (let i = 1; i < bars.length - 1; i += 1) {
    const bar = bars[i] as PivotBar;
    if (bar.high > (bars[i - 1] as PivotBar).high && bar.high > (bars[i + 1] as PivotBar).high) {
      out.push({ time: bar.time, price: bar.high, index: i });
    }
  }
  return out;
}

/** Bars strictly lower than both neighbours, in time order. */
export function pivotLows(bars: readonly PivotBar[]): Pivot[] {
  const out: Pivot[] = [];
  for (let i = 1; i < bars.length - 1; i += 1) {
    const bar = bars[i] as PivotBar;
    if (bar.low < (bars[i - 1] as PivotBar).low && bar.low < (bars[i + 1] as PivotBar).low) {
      out.push({ time: bar.time, price: bar.low, index: i });
    }
  }
  return out;
}

/**
 * The highest pivot high in the window, or `null` when the window holds no pivot at all.
 *
 * `null` is the honest answer for a monotonic run — a window that only rose has no swing high in
 * it, and reporting its last bar would claim a structure that is not there.
 */
export function highestPivotHigh(bars: readonly PivotBar[]): Pivot | null {
  return pivotHighs(bars).reduce<Pivot | null>(
    (best, p) => (best === null || p.price > best.price ? p : best),
    null,
  );
}

/** The lowest pivot low in the window, or `null` when the window holds no pivot at all. */
export function lowestPivotLow(bars: readonly PivotBar[]): Pivot | null {
  return pivotLows(bars).reduce<Pivot | null>(
    (best, p) => (best === null || p.price < best.price ? p : best),
    null,
  );
}

/**
 * The last swing low before the window's highest point — §8.2's `structure.impulse_low_15m`,
 * "the low of the last 15m impulse leg (last swing low before the current high)".
 *
 * `null` when there is no pivot low before the high: a leg that began outside the window has no
 * measurable start inside it, and guessing one would understate the impulse.
 */
export function impulseLow(bars: readonly PivotBar[]): Pivot | null {
  if (bars.length === 0) return null;
  let highIndex = 0;
  for (let i = 1; i < bars.length; i += 1) {
    if ((bars[i] as PivotBar).high > (bars[highIndex] as PivotBar).high) highIndex = i;
  }
  const before = pivotLows(bars).filter((p) => p.index < highIndex);
  return before.length === 0 ? null : (before[before.length - 1] as Pivot);
}

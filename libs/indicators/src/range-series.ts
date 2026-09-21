import { Candle } from '@trade-automation/contracts';
import { IndicatorSeries, assertLength } from './series';

/**
 * T-034 — the series form of the lifted `computeRange` (range.ts, unchanged): the value at bar i is
 * `computeRange(bars[0..i], length)` — the highest high and lowest low of the `length` bars
 * immediately **before** bar i (i − length .. i − 1), and `middle = (top + bottom) / 2`, the
 * plug-in's premium/discount line. First defined at bar `length`.
 *
 * Not session-anchored: a count-based rolling window that runs straight across UTC midnight,
 * as the plug-in's (its 200 bars always sit inside the 12 h main window). Monotonic deques keep it
 * O(n); max/min are exact, so it matches the lifted function bit for bit. Output series: `top`,
 * `middle`, `bottom`.
 */
export function rangeSeries(bars: readonly Candle[], params: { length: number }): IndicatorSeries<'top' | 'middle' | 'bottom'> {
  const n = params.length;
  assertLength('length', n);
  const top: IndicatorSeries['top'] = [];
  const middle: IndicatorSeries['middle'] = [];
  const bottom: IndicatorSeries['bottom'] = [];

  // Indices into `bars`, covering the window before bar i: highs decreasing, lows increasing.
  const highs = new Int32Array(bars.length);
  const lows = new Int32Array(bars.length);
  let hHead = 0;
  let hTail = 0;
  let lHead = 0;
  let lTail = 0;
  for (let i = 1; i < bars.length; i++) {
    const k = i - 1; // the newest bar of the window before bar i
    while (hTail > hHead && bars[highs[hTail - 1]].high <= bars[k].high) hTail--;
    highs[hTail++] = k;
    while (lTail > lHead && bars[lows[lTail - 1]].low >= bars[k].low) lTail--;
    lows[lTail++] = k;
    if (highs[hHead] < i - n) hHead++;
    if (lows[lHead] < i - n) lHead++;
    if (i < n) continue;
    const t = bars[highs[hHead]].high;
    const b = bars[lows[lHead]].low;
    const time = bars[i].openTime;
    top.push({ time, value: t });
    middle.push({ time, value: (t + b) / 2 });
    bottom.push({ time, value: b });
  }
  return { top, middle, bottom };
}

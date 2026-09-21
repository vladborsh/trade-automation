import { Candle } from '@trade-automation/contracts';
import { IndicatorSeries, assertLength, toSeries } from './series';

/**
 * T-034 — the series form of the lifted `computeAtr` (atr.ts, unchanged): the value at bar i is
 * `computeAtr(bars[0..i], length)`, i.e. the arithmetic mean of the true range of bars
 * `i − length + 1 .. i` (a true range needs the previous close, so bar 0 has none). First defined at
 * bar `length`. A running sum keeps it O(n); it agrees with the lifted function to 1e-9 relative
 * (the parity spec), not bit for bit. Output series: `atr`.
 */
export function atrSeries(bars: readonly Candle[], params: { length: number }): IndicatorSeries<'atr'> {
  const n = params.length;
  assertLength('length', n);
  if (bars.length < n + 1) return { atr: [] };

  const tr = new Float64Array(bars.length);
  for (let k = 1; k < bars.length; k++) {
    const { high, low } = bars[k];
    const prevClose = bars[k - 1].close;
    tr[k] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }
  const values = new Float64Array(bars.length);
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    sum += tr[i];
    if (i > n) sum -= tr[i - n];
    if (i >= n) values[i] = sum / n;
  }
  return { atr: toSeries(bars, values, n) };
}

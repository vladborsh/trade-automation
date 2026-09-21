import { Candle } from '@trade-automation/contracts';
import { IndicatorSeries, assertLength, toSeries } from './series';

/**
 * RSI(length) of the close with **Wilder** smoothing (TA-Lib `RSI`, TradingView `ta.rsi`):
 * - the change of bar i is `close[i] − close[i−1]`; gains are its positive part, losses its
 *   negative part as a positive number;
 * - the first averages are the simple means of the gains and of the losses of changes 1..length;
 *   then `avg = (avg_prev · (length − 1) + x) / length`;
 * - `RSI = 100 − 100 / (1 + avgGain/avgLoss)`; when `avgLoss = 0` it is 100, and when both
 *   averages are 0 (a flat run) it is 0 — TA-Lib's convention, pinned by the reference spec
 *   (TradingView would give 100 for the flat run).
 *
 * First defined at bar `length` (it needs `length` changes). Output series: `rsi`.
 */
export function rsi(bars: readonly Candle[], params: { length: number }): IndicatorSeries<'rsi'> {
  const n = params.length;
  assertLength('length', n);
  const values = new Float64Array(bars.length);
  if (bars.length <= n) return { rsi: [] };

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= n; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= n;
  avgLoss /= n;
  values[n] = rsiValue(avgGain, avgLoss);
  for (let i = n + 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    avgGain = (avgGain * (n - 1) + (change > 0 ? change : 0)) / n;
    avgLoss = (avgLoss * (n - 1) + (change < 0 ? -change : 0)) / n;
    values[i] = rsiValue(avgGain, avgLoss);
  }
  return { rsi: toSeries(bars, values, n) };
}

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 0 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

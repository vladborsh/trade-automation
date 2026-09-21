import { Candle } from '@trade-automation/contracts';
import { IndicatorSeries, assertLength, closes, toSeries } from './series';

/**
 * Bollinger Bands(length, stdDevs) of the close (TA-Lib `BBANDS` with an SMA, TradingView
 * `ta.bb`): `middle = SMA(length)`, `upper/lower = middle ± stdDevs · σ`, where σ is the
 * **population** standard deviation (divide by `length`, not `length − 1`) of the same `length`
 * closes. σ is computed per window from the deviations (not from running sums of squares), so large
 * prices keep full precision. First defined at bar `length − 1`. Output series: `upper`, `middle`,
 * `lower`.
 */
export function bollinger(
  bars: readonly Candle[],
  params: { length: number; stdDevs: number },
): IndicatorSeries<'upper' | 'middle' | 'lower'> {
  const n = params.length;
  assertLength('length', n);
  if (!(params.stdDevs > 0) || !Number.isFinite(params.stdDevs)) throw new RangeError(`stdDevs must be a positive number (got ${params.stdDevs})`);

  const c = closes(bars);
  const upper = new Float64Array(bars.length);
  const middle = new Float64Array(bars.length);
  const lower = new Float64Array(bars.length);
  for (let i = n - 1; i < bars.length; i++) {
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) sum += c[k];
    const mean = sum / n;
    let sq = 0;
    for (let k = i - n + 1; k <= i; k++) sq += (c[k] - mean) * (c[k] - mean);
    const band = params.stdDevs * Math.sqrt(sq / n);
    middle[i] = mean;
    upper[i] = mean + band;
    lower[i] = mean - band;
  }
  const start = n - 1;
  return { upper: toSeries(bars, upper, start), middle: toSeries(bars, middle, start), lower: toSeries(bars, lower, start) };
}

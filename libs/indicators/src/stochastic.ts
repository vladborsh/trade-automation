import { Candle } from '@trade-automation/contracts';
import { IndicatorSeries, assertLength, smaOf, toSeries } from './series';

/**
 * Stochastic(kLength, dLength, smoothing) — the "slow" stochastic (TA-Lib `STOCH` with SMA
 * smoothing; TradingView's `ta.stoch` smoothed by `ta.sma`):
 * - raw %K at bar i = `100 · (close − lowest low) / (highest high − lowest low)` over the last
 *   `kLength` bars; when the range is 0 it is 0 (TA-Lib's convention);
 * - `k = SMA(smoothing)` of raw %K — first defined at bar `kLength + smoothing − 2`;
 * - `d = SMA(dLength)` of `k` — first defined at bar `kLength + smoothing + dLength − 3`.
 *
 * Each output starts at its own first defined bar (TA-Lib reports %K only from %D's start). With
 * `smoothing = 1`, `k` is the raw (fast) %K. Output series: `k`, `d`.
 */
export function stochastic(
  bars: readonly Candle[],
  params: { kLength: number; dLength: number; smoothing: number },
): IndicatorSeries<'k' | 'd'> {
  assertLength('kLength', params.kLength);
  assertLength('dLength', params.dLength);
  assertLength('smoothing', params.smoothing);

  const n = params.kLength;
  const raw = new Float64Array(bars.length);
  for (let i = n - 1; i < bars.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      if (bars[j].high > hi) hi = bars[j].high;
      if (bars[j].low < lo) lo = bars[j].low;
    }
    raw[i] = hi === lo ? 0 : (100 * (bars[i].close - lo)) / (hi - lo);
  }
  const k = smaOf(raw, params.smoothing, n - 1);
  const d = smaOf(k.values, params.dLength, k.start);
  return { k: toSeries(bars, k.values, k.start), d: toSeries(bars, d.values, d.start) };
}

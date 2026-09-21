import { Candle } from '@trade-automation/contracts';
import { IndicatorSeries, assertLength, closes, emaOf, smaOf, toSeries } from './series';

/**
 * SMA(length) of the close: the arithmetic mean of the last `length` closes. First defined at bar
 * `length − 1`. Output series: `sma`.
 */
export function sma(bars: readonly Candle[], params: { length: number }): IndicatorSeries<'sma'> {
  assertLength('length', params.length);
  const { values, start } = smaOf(closes(bars), params.length);
  return { sma: toSeries(bars, values, start) };
}

/**
 * EMA(length) of the close, `α = 2/(length + 1)`, seeded with the SMA of the first `length` closes
 * (TA-Lib's default; TradingView's `ta.ema`). First defined at bar `length − 1`. Output series:
 * `ema`.
 */
export function ema(bars: readonly Candle[], params: { length: number }): IndicatorSeries<'ema'> {
  assertLength('length', params.length);
  const { values, start } = emaOf(closes(bars), params.length);
  return { ema: toSeries(bars, values, start) };
}

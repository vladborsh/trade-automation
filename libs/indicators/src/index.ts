/**
 * architecture/backtest-app-system-design.md §2.1, D1 — @trade-automation/indicators: pure
 * indicators, one implementation for the server's strategy plug-ins and the client's charts.
 * Browser-safe: no Node imports. The five below were lifted verbatim from the vwap-band-reversal
 * plug-in (bodies unchanged, so the bug-faithful semantics documented in
 * knowledge/vwap-band-reversal-ict.md are preserved).
 */
export { computeAtr } from './atr';
export { computeFvg, type FvgBox, type FvgResult } from './fvg';
export { computePreviousHourLH, type PreviousHourResult } from './previous-hour';
export { computeRange, type RangeResult } from './range';
export { computeVwapBand, type VwapBandResult } from './vwap';

// T-027 — written for the backtest app (design §2.1): each `(bars, params) → IndicatorSeries`, plus
// the catalog the client picker renders.
export { bollinger } from './bollinger';
export { macd } from './macd';
export { ema, sma } from './moving-averages';
export { rsi } from './rsi';
export { stochastic } from './stochastic';
export type { IndicatorSeries, IndicatorValue } from './series';
export {
  INDICATOR_CATALOG,
  defaultParams,
  indicatorById,
  type IndicatorCatalogEntry,
  type IndicatorId,
  type IndicatorOutputSpec,
  type IndicatorParamSpec,
} from './catalog';

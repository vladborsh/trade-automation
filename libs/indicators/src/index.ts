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

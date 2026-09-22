import { Candle, OverlayPrimitive } from '@trade-automation/contracts';
import { atrSeries } from './atr-series';
import { bollinger } from './bollinger';
import { type IfvgBox, ifvgBoxes } from './fvg-series';
import { macd } from './macd';
import { ema, sma } from './moving-averages';
import { previousHourSeries } from './previous-hour-series';
import { rangeSeries } from './range-series';
import { rsi } from './rsi';
import { IndicatorSeries } from './series';
import { stochastic } from './stochastic';
import { vwapBandSeries } from './vwap-series';

/** One numeric parameter the picker renders: label, default and allowed range. */
export interface IndicatorParamSpec {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  integer: boolean;
}

/** One output series of an indicator. */
export interface IndicatorOutputSpec {
  key: string;
  label: string;
  /** T-057: how the series is drawn; a line when absent (`IndicatorSeriesSpec` keys' `plot`). */
  plot?: 'line' | 'histogram';
}

/**
 * An entry the client's indicator picker renders without hardcoding anything (T-027): id, display
 * name, where it draws (`overlay` on the price pane, or a `separate` pane below), its parameters
 * with defaults, its output series, and `compute`. `range` gives a separate pane its fixed scale
 * (0..100 for the oscillators) and `levels` its reference lines.
 *
 * T-057: `overlays`, when present, returns chart primitives drawn in addition to the series — over
 * the same bars and params as `compute` (the iFVG boxes). Kept beside `compute` rather than in its
 * result, so every series consumer reads `compute` unchanged.
 */
export interface IndicatorCatalogEntry {
  id: IndicatorId;
  name: string;
  pane: 'overlay' | 'separate';
  params: readonly IndicatorParamSpec[];
  outputs: readonly IndicatorOutputSpec[];
  range?: { min: number; max: number };
  levels?: readonly number[];
  compute(bars: readonly Candle[], params: Readonly<Record<string, number>>): IndicatorSeries;
  overlays?(bars: readonly Candle[], params: Readonly<Record<string, number>>): OverlayPrimitive[];
}

export type IndicatorId = 'sma' | 'ema' | 'rsi' | 'macd' | 'bollinger' | 'stochastic' | 'vwap' | 'atr' | 'range' | 'prev-hour' | 'fvg';

const lengthParam = (key: string, label: string, def: number): IndicatorParamSpec => ({
  key,
  label,
  default: def,
  min: 1,
  max: 1000,
  step: 1,
  integer: true,
});

const p = (params: Readonly<Record<string, number>>, key: string) => params[key];

export const INDICATOR_CATALOG: readonly IndicatorCatalogEntry[] = [
  {
    id: 'sma',
    name: 'Simple moving average',
    pane: 'overlay',
    params: [lengthParam('length', 'Length', 20)],
    outputs: [{ key: 'sma', label: 'SMA' }],
    compute: (bars, params) => sma(bars, { length: p(params, 'length') }),
  },
  {
    id: 'ema',
    name: 'Exponential moving average',
    pane: 'overlay',
    params: [lengthParam('length', 'Length', 20)],
    outputs: [{ key: 'ema', label: 'EMA' }],
    compute: (bars, params) => ema(bars, { length: p(params, 'length') }),
  },
  {
    id: 'bollinger',
    name: 'Bollinger Bands',
    pane: 'overlay',
    params: [lengthParam('length', 'Length', 20), { key: 'stdDevs', label: 'Standard deviations', default: 2, min: 0.1, max: 10, step: 0.1, integer: false }],
    outputs: [
      { key: 'upper', label: 'Upper' },
      { key: 'middle', label: 'Middle' },
      { key: 'lower', label: 'Lower' },
    ],
    compute: (bars, params) => bollinger(bars, { length: p(params, 'length'), stdDevs: p(params, 'stdDevs') }),
  },
  {
    id: 'rsi',
    name: 'Relative strength index',
    pane: 'separate',
    params: [lengthParam('length', 'Length', 14)],
    outputs: [{ key: 'rsi', label: 'RSI' }],
    range: { min: 0, max: 100 },
    levels: [30, 70],
    compute: (bars, params) => rsi(bars, { length: p(params, 'length') }),
  },
  {
    id: 'macd',
    name: 'MACD',
    pane: 'separate',
    params: [lengthParam('fast', 'Fast length', 12), lengthParam('slow', 'Slow length', 26), lengthParam('signal', 'Signal length', 9)],
    outputs: [
      { key: 'macd', label: 'MACD' },
      { key: 'signal', label: 'Signal' },
      { key: 'hist', label: 'Histogram', plot: 'histogram' },
    ],
    levels: [0],
    compute: (bars, params) => macd(bars, { fast: p(params, 'fast'), slow: p(params, 'slow'), signal: p(params, 'signal') }),
  },
  {
    id: 'stochastic',
    name: 'Stochastic',
    pane: 'separate',
    params: [lengthParam('kLength', '%K length', 14), lengthParam('dLength', '%D length', 3), lengthParam('smoothing', '%K smoothing', 3)],
    outputs: [
      { key: 'k', label: '%K' },
      { key: 'd', label: '%D' },
    ],
    range: { min: 0, max: 100 },
    levels: [20, 80],
    compute: (bars, params) =>
      stochastic(bars, { kLength: p(params, 'kLength'), dLength: p(params, 'dLength'), smoothing: p(params, 'smoothing') }),
  },
  // T-034 — the five lifted from the vwap-band-reversal plug-in, as series. Defaults are the
  // plug-in's (strategies.yaml: atrBars 20, rangeBars 200); VWAP, previous hour and iFVG have none.
  {
    id: 'vwap',
    name: 'VWAP band (UTC day from 00:01, ±1σ)',
    pane: 'overlay',
    params: [],
    outputs: [
      { key: 'vwap', label: 'VWAP' },
      { key: 'upper', label: '+1σ' },
      { key: 'lower', label: '−1σ' },
    ],
    compute: (bars) => vwapBandSeries(bars),
  },
  {
    id: 'atr',
    name: 'Average true range',
    pane: 'separate',
    params: [lengthParam('length', 'Length', 20)],
    outputs: [{ key: 'atr', label: 'ATR' }],
    compute: (bars, params) => atrSeries(bars, { length: p(params, 'length') }),
  },
  {
    id: 'range',
    name: 'Range high / low (bars before the current one)',
    pane: 'overlay',
    params: [lengthParam('length', 'Length', 200)],
    outputs: [
      { key: 'top', label: 'Top' },
      { key: 'middle', label: 'Middle' },
      { key: 'bottom', label: 'Bottom' },
    ],
    compute: (bars, params) => rangeSeries(bars, { length: p(params, 'length') }),
  },
  {
    id: 'prev-hour',
    name: 'Previous UTC hour high / low',
    pane: 'overlay',
    params: [],
    outputs: [
      { key: 'high', label: 'High' },
      { key: 'low', label: 'Low' },
    ],
    compute: (bars) => previousHourSeries(bars),
  },
  // T-057: every inverse FVG as a box (the gap's bars → the bar that pruned it), not the two lines of
  // the latest one; no series. No label on the box (T-047: lines only on replay panels).
  {
    id: 'fvg',
    name: 'Inverse FVGs',
    pane: 'overlay',
    params: [],
    outputs: [],
    compute: () => ({}),
    overlays: (bars) => ifvgBoxes(bars).map(ifvgRect),
  },
];

/**
 * Up/down palette (AGENTS.md) at two strengths: a live box in the plain colour, a pruned one at 40 %.
 * The chart's rect renderer (ShapesPrimitive) already fills at 15 % opacity, so these multiply to
 * ~15 % and ~6 % on screen.
 */
const IFVG_FILL = {
  bullish: { live: '#26a69a', pruned: 'rgba(38, 166, 154, 0.4)' },
  bearish: { live: '#ef5350', pruned: 'rgba(239, 83, 80, 0.4)' },
} as const;

/** One iFVG box as the contracts' `rect` overlay (from/to/top/bottom, no label). */
export function ifvgRect(box: IfvgBox): OverlayPrimitive {
  return { type: 'rect', from: box.from, to: box.to, top: box.top, bottom: box.bottom, color: IFVG_FILL[box.side][box.live ? 'live' : 'pruned'] };
}

/** The catalog entry for `id`, or undefined. */
export function indicatorById(id: string): IndicatorCatalogEntry | undefined {
  return INDICATOR_CATALOG.find((e) => e.id === id);
}

/** The default parameter values of an entry, as `compute` takes them. */
export function defaultParams(entry: IndicatorCatalogEntry): Record<string, number> {
  return Object.fromEntries(entry.params.map((param) => [param.key, param.default]));
}

import { CandlestickSeries, LineSeries, type IChartApi, type Time } from 'lightweight-charts';
import { MetricSeriesRenderer } from '@backtest-features/chart/metric-series.renderer';
import { LiquidationHistogramRenderer } from './liquidation-histogram.renderer';
import type { PaneData } from './pane-data';
import type { PanelDef } from './panels.model';
import {
  toCandleData, toCvdSegments, toFundingSteps, toLongShortLine, toOpenInterestPoints,
  toPredictedFunding, toTakerDelta,
} from './series.adapter';

/**
 * IB-BUG-009 — what each panel draws, one function per panel key.
 *
 * Extracted from `instrument-chart.component.ts`, which previously held the whole six-pane draw
 * inline. Six charts need the same work done six times over, and AGENTS.md caps a component at
 * 250 lines; keeping the drawing here leaves the component to layout and lifecycle only.
 *
 * Every function attaches to **pane 0 of its own chart** — in a row there are no sub-panes, which
 * is the one simplification the layout buys: the pane indices IB-031 had to thread through
 * (`1` for OI, `2` for liquidations, and so on, each to keep one series off the price scale) all
 * collapse to 0, because a panel's scale is now its own by construction.
 */

/** Renderers that hold state across redraws, one set per panel instance. */
export interface PanelRenderers {
  oi: MetricSeriesRenderer;
  liquidations: LiquidationHistogramRenderer;
}

export function createPanelRenderers(): PanelRenderers {
  return { oi: new MetricSeriesRenderer(), liquidations: new LiquidationHistogramRenderer() };
}

const asLine = (points: ReadonlyArray<{ time: number; value: number }>): Array<{ time: Time; value: number }> =>
  points as unknown as Array<{ time: Time; value: number }>;

function drawPrice(chart: IChartApi, data: PaneData): void {
  const price = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });
  price.setData(toCandleData(data.candles.candles) as never);
}

function drawOpenInterest(chart: IChartApi, data: PaneData, renderers: PanelRenderers): void {
  if (!renderers.oi.series) renderers.oi.attach(chart, data.timeframe as never);
  renderers.oi.setData(toOpenInterestPoints(data.openInterest, data.instrument, data.timeframe));
}

function drawLiquidations(chart: IChartApi, data: PaneData, renderers: PanelRenderers): void {
  if (!renderers.liquidations.attached) renderers.liquidations.attach(chart);
  renderers.liquidations.setData(data.liquidations.bars);
}

function drawDelta(chart: IChartApi, data: PaneData): void {
  // CVD is drawn as segments so an outage stays a hole rather than a straight line (IB-031).
  for (const segment of toCvdSegments(data.candles.candles)) {
    chart.addSeries(LineSeries, { color: '#8b949e', lineWidth: 1, lastValueVisible: false }).setData(asLine(segment));
  }
  chart
    .addSeries(LineSeries, { color: '#c9d1d9', lineWidth: 1, lastValueVisible: false })
    .setData(asLine(toTakerDelta(data.candles.candles)));
}

function drawFunding(chart: IChartApi, data: PaneData): void {
  for (const venue of data.funding.settled) {
    chart
      .addSeries(LineSeries, { color: '#26a69a', lineWidth: 1, lastValueVisible: false })
      .setData(asLine(toFundingSteps(venue.points)));
  }
  chart
    .addSeries(LineSeries, { color: '#8b949e', lineWidth: 1, lineStyle: 2, lastValueVisible: false })
    .setData(asLine(toPredictedFunding(data.funding)));
}

function drawLongShort(chart: IChartApi, data: PaneData): void {
  chart
    .addSeries(LineSeries, { color: '#c9d1d9', lineWidth: 1, lastValueVisible: false })
    .setData(asLine(toLongShortLine(data.longShort)));
}

const DRAW: Record<PanelDef['key'], (chart: IChartApi, data: PaneData, renderers: PanelRenderers) => void> = {
  price: drawPrice,
  openInterest: drawOpenInterest,
  liquidations: drawLiquidations,
  delta: drawDelta,
  funding: drawFunding,
  longShort: drawLongShort,
};

/** Draws one panel. Unknown keys cannot occur — `PanelDef['key']` is a closed union. */
export function drawPanel(key: PanelDef['key'], chart: IChartApi, data: PaneData, renderers: PanelRenderers): void {
  DRAW[key](chart, data, renderers);
}

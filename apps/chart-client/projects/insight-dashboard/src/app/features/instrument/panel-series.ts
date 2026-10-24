import { CandlestickSeries, LineSeries, type IChartApi, type Time } from 'lightweight-charts';
import { MetricSeriesRenderer } from '@backtest-features/chart/metric-series.renderer';
import { toLiquidationMarkers } from './liquidation-markers.adapter';
import { LiquidationMarkersPrimitive } from './liquidation-markers.primitive';
import type { PaneData } from './pane-data';
import { paneIndexOf, type PanelDef } from './panels.model';
import {
  toCandleData, toCloseLine, toCvdSegments, toFundingSteps, toLongShortLine, toOpenInterestPoints,
  toPredictedFunding, toTakerDelta,
} from './series.adapter';

/**
 * What each pane draws, one function per panel key.
 *
 * 2026-10-24: back to ONE chart with panes (the user's choice of layout), so every function now
 * draws into **its pane of the shared chart**, `paneIndexOf(key)`, instead of pane 0 of a chart of
 * its own. That is what IB-031 did before IB-BUG-009; what is kept from IB-BUG-009 is that no two
 * panes share a price scale, which is automatic in lightweight-charts 5: each pane has its own.
 */

/** Renderers that hold state across a redraw, one set per chart. */
export interface PanelRenderers {
  oi: MetricSeriesRenderer;
  /** IB-039: the liquidation bubbles over the price series (§12.5). */
  markers: LiquidationMarkersPrimitive;
}

export function createPanelRenderers(): PanelRenderers {
  return { oi: new MetricSeriesRenderer(), markers: new LiquidationMarkersPrimitive() };
}

/** The spot line's colour: the palette's text colour, thin, so it reads over both candle colours. */
export const SPOT_LINE_COLOUR = '#c9d1d9';

const asLine = (points: ReadonlyArray<{ time: number; value: number }>): Array<{ time: Time; value: number }> =>
  points as unknown as Array<{ time: Time; value: number }>;

function drawPrice(chart: IChartApi, data: PaneData, renderers: PanelRenderers, pane: number): void {
  const price = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  }, pane);
  price.setData(toCandleData(data.candles.candles) as never);

  // 2026-10-24: spot as a line ON the futures price pane, same scale, so the gap is the premium.
  if (data.spotCandles && data.spotCandles.candles.length > 0) {
    chart
      .addSeries(LineSeries, { color: SPOT_LINE_COLOUR, lineWidth: 1, lastValueVisible: false, priceLineVisible: false }, pane)
      .setData(asLine(toCloseLine(data.spotCandles.candles)));
  }

  // IB-039 §12.5 — liquidations as bubbles ON the price, bucketed to the bar on screen so a
  // cascade reads as one big circle rather than a smear of overlapping dots.
  price.attachPrimitive(renderers.markers);
  renderers.markers.setMarkers(toLiquidationMarkers(data.liquidationEvents, {
    barSeconds: barSecondsOf(data.timeframe),
  }));
}

/** The chart's bar length, which is what the markers bucket to. */
function barSecondsOf(timeframe: string): number {
  const SEC: Record<string, number> = { '1m': 60, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400 };
  return SEC[timeframe] ?? 60;
}

function drawOpenInterest(chart: IChartApi, data: PaneData, renderers: PanelRenderers, pane: number): void {
  if (!renderers.oi.series) renderers.oi.attach(chart, data.timeframe as never, pane);
  renderers.oi.setData(toOpenInterestPoints(data.openInterest, data.instrument, data.timeframe));
}

function drawDelta(chart: IChartApi, data: PaneData, _renderers: PanelRenderers, pane: number): void {
  // CVD is drawn as segments so an outage stays a hole rather than a straight line (IB-031).
  for (const segment of toCvdSegments(data.candles.candles)) {
    chart.addSeries(LineSeries, { color: '#8b949e', lineWidth: 1, lastValueVisible: false }, pane).setData(asLine(segment));
  }
  chart
    .addSeries(LineSeries, { color: '#c9d1d9', lineWidth: 1, lastValueVisible: false }, pane)
    .setData(asLine(toTakerDelta(data.candles.candles)));
}

function drawFunding(chart: IChartApi, data: PaneData, _renderers: PanelRenderers, pane: number): void {
  for (const venue of data.funding.settled) {
    chart
      .addSeries(LineSeries, { color: '#26a69a', lineWidth: 1, lastValueVisible: false }, pane)
      .setData(asLine(toFundingSteps(venue.points)));
  }
  chart
    .addSeries(LineSeries, { color: '#8b949e', lineWidth: 1, lineStyle: 2, lastValueVisible: false }, pane)
    .setData(asLine(toPredictedFunding(data.funding)));
}

function drawLongShort(chart: IChartApi, data: PaneData, _renderers: PanelRenderers, pane: number): void {
  chart
    .addSeries(LineSeries, { color: '#c9d1d9', lineWidth: 1, lastValueVisible: false }, pane)
    .setData(asLine(toLongShortLine(data.longShort)));
}

type Draw = (chart: IChartApi, data: PaneData, renderers: PanelRenderers, pane: number) => void;

const DRAW: Record<PanelDef['key'], Draw> = {
  price: drawPrice,
  openInterest: drawOpenInterest,
  delta: drawDelta,
  funding: drawFunding,
  longShort: drawLongShort,
};

/** Draws one panel into its pane. Unknown keys cannot occur — `PanelDef['key']` is a closed union. */
export function drawPanel(key: PanelDef['key'], chart: IChartApi, data: PaneData, renderers: PanelRenderers): void {
  DRAW[key](chart, data, renderers, paneIndexOf(key));
}

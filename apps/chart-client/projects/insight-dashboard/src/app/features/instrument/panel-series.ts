import { CandlestickSeries, LineSeries, LineStyle, LineType, type IChartApi, type Time } from 'lightweight-charts';
import { MetricSeriesRenderer } from '@backtest-features/chart/metric-series.renderer';
import { daySeparatorTimes, showsDaySeparators } from './day-separators';
import { toLiquidationMarkers } from './liquidation-markers.adapter';
import { LiquidationMarkersPrimitive } from './liquidation-markers.primitive';
import type { PaneData } from './pane-data';
import { paneIndexOf, type PanelDef } from './panels.model';
import { LEVEL_COLOURS, LEVEL_LINES, levelSteps, previousDayLevels, previousWeekLevels } from './prior-levels';
import {
  toCandleData, toCvdSegments, toFundingSteps, toLongShortLine, toOpenInterestPoints,
  toPredictedFunding, toTakerDelta,
} from './series.adapter';
import { barSeconds, snapToGrid } from './time-grid';
import { TimeMarksPrimitive } from './time-marks.primitive';
import { sessionBands, showsSessions } from './trading-sessions';

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

const asLine = (points: ReadonlyArray<{ time: number; value: number }>): Array<{ time: Time; value: number }> =>
  points as unknown as Array<{ time: Time; value: number }>;

function drawPrice(chart: IChartApi, data: PaneData, renderers: PanelRenderers, pane: number): void {
  const price = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  }, pane);
  price.setData(toCandleData(data.candles.candles) as never);
  drawLevels(chart, data, pane);

  // IB-039 §12.5 — liquidations as bubbles ON the price, bucketed to the bar on screen so a
  // cascade reads as one big circle rather than a smear of overlapping dots.
  price.attachPrimitive(renderers.markers);
  renderers.markers.setMarkers(toLiquidationMarkers(data.liquidationEvents, {
    barSeconds: barSeconds(data.timeframe),
  }));
}

/**
 * PDH/PDL/PWH/PWL (prior-levels.ts): thin dashed steps, titled on the price axis. Left out of the
 * pane's autoscale: on 1m the previous week's range can be ten times the day's, and a scale
 * stretched to reach it would flatten the candles; a level off the visible scale is off screen.
 */
function drawLevels(chart: IChartApi, data: PaneData, pane: number): void {
  const times = candleTimes(data);
  const periods = { day: previousDayLevels(data.dailyCandles), week: previousWeekLevels(data.dailyCandles) };
  for (const line of LEVEL_LINES) {
    const points = levelSteps(periods[line.period], times, line.pick);
    if (points.length === 0) continue;
    chart.addSeries(LineSeries, {
      color: LEVEL_COLOURS[line.period], lineWidth: 1, lineStyle: LineStyle.Dashed, lineType: LineType.WithSteps,
      title: line.title, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => null,
    }, pane).setData(points as never);
  }
}

/** The candle times every overlay is placed on: one time-scale slot per bar (time-grid.ts). */
const candleTimes = (data: PaneData): number[] => toCandleData(data.candles.candles).map((c) => c.time);

/**
 * Day separators on every pane up to 4h, and on the price pane the London and New York session
 * bands up to 1h, as one pane primitive under the series (time-marks.primitive.ts).
 */
function drawTimeMarks(chart: IChartApi, data: PaneData, key: PanelDef['key'], pane: number): void {
  const target = chart.panes()[pane];
  if (!target) return;
  const times = candleTimes(data);
  const lines = showsDaySeparators(data.timeframe) ? daySeparatorTimes(times) : [];
  const bands = key === 'price' && showsSessions(data.timeframe) ? sessionBands(times, barSeconds(data.timeframe)) : [];
  if (lines.length > 0 || bands.length > 0) target.attachPrimitive(new TimeMarksPrimitive({ lines, bands }));
}

/** Any series onto the candle grid: one time-scale slot per bar however many series (time-grid.ts). */
const onGrid = <T extends { time: number }>(points: readonly T[], data: PaneData): T[] =>
  snapToGrid(points, barSeconds(data.timeframe));

function drawOpenInterest(chart: IChartApi, data: PaneData, renderers: PanelRenderers, pane: number): void {
  // Always the renderer's LINE style: an open-interest reading is a snapshot, and its candle style
  // would draw each bar as a flat dash. Attached as '1m' because that is what selects the line.
  if (!renderers.oi.series) renderers.oi.attach(chart, '1m', pane);
  renderers.oi.setData(toOpenInterestPoints(onGrid(data.openInterest, data), data.instrument, data.timeframe));
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
      .setData(asLine(onGrid(toFundingSteps(venue.points), data)));
  }
  chart
    .addSeries(LineSeries, { color: '#8b949e', lineWidth: 1, lineStyle: 2, lastValueVisible: false }, pane)
    .setData(asLine(onGrid(toPredictedFunding(data.funding), data)));
}

function drawLongShort(chart: IChartApi, data: PaneData, _renderers: PanelRenderers, pane: number): void {
  chart
    .addSeries(LineSeries, { color: '#c9d1d9', lineWidth: 1, lastValueVisible: false }, pane)
    .setData(asLine(onGrid(toLongShortLine(data.longShort), data)));
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
  const pane = paneIndexOf(key);
  DRAW[key](chart, data, renderers, pane);
  drawTimeMarks(chart, data, key, pane);
}

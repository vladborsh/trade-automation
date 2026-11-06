import {
  CandlestickSeries, LineSeries, LineStyle, LineType, createSeriesMarkers, type IChartApi, type IPaneApi,
  type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesType, type Time,
} from 'lightweight-charts';
import { toAlertMarkers } from './alert-marks';
import { MetricSeriesRenderer } from '@backtest-features/chart/metric-series.renderer';
import { calendarMarks, EVENT_LINE_COLOUR, type CalendarMark } from './calendar-marks';
import { daySeparatorTimes, showsDaySeparators } from './day-separators';
import { futureSlots } from './future-bars';
import { toLiquidationMarkers } from './liquidation-markers.adapter';
import { LiquidationMarkersPrimitive } from './liquidation-markers.primitive';
import { divergenceStrokes, divergenceTf, OI_CONTRACTS_COLOUR, OI_CONTRACTS_SCALE } from './oi-divergence-lines';
import type { PaneData } from './pane-data';
import { paneIndexOf, type PanelDef } from './panels.model';
import { levelLines, type LevelDash } from './prior-levels';
import { customLevelLines } from './custom-level-lines';
import {
  toCandleData, toCvdSegments, toFundingSteps, toLongShortLine, toOpenInterestPoints,
  toPredictedFunding, toTakerDelta,
} from './series.adapter';
import { barSeconds, snapToGrid } from './time-grid';
import { TimeMarksPrimitive } from './time-marks.primitive';
import { sessionBands, showsSessions } from './trading-sessions';
import { closedBands } from './weekend-bands';

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
  /** IB-066: the pane primitives drawn, so a redraw in place can take them off again. */
  paneMarks: Array<{ pane: IPaneApi<Time>; primitive: TimeMarksPrimitive }>;
  /** IB-129: the alert markers on the candles (`alert-marks.ts`); null until the price pane is drawn. */
  alertMarkers: ISeriesMarkersPluginApi<Time> | null;
  /** IB-153: the candles, which the liquidation profile strip attaches to; null until the price pane is drawn. */
  price: ISeriesApi<SeriesType> | null;
}

export function createPanelRenderers(): PanelRenderers {
  return { oi: new MetricSeriesRenderer(), markers: new LiquidationMarkersPrimitive(), paneMarks: [], alertMarkers: null, price: null };
}

/**
 * IB-066 — every panel drawn again on the SAME chart, for data that extends what is on screen (the
 * live tail, an earlier window): the new series go on first and the old ones come off after, so no
 * pane is ever empty and the time scale — the reader's zoom and scroll — is never rebuilt.
 * Returns the new renderers.
 */
export function redrawPanels(chart: IChartApi, data: PaneData, old: PanelRenderers, keys: ReadonlyArray<PanelDef['key']>): PanelRenderers {
  const stale = chart.panes().flatMap((pane) => pane.getSeries());
  const renderers = createPanelRenderers();
  for (const key of keys) drawPanel(key, chart, data, renderers);
  for (const { pane, primitive } of old.paneMarks) pane.detachPrimitive(primitive);
  for (const series of stale) chart.removeSeries(series);
  return renderers;
}

const asLine = (points: ReadonlyArray<{ time: number; value: number }>): Array<{ time: Time; value: number }> =>
  points as unknown as Array<{ time: Time; value: number }>;

function drawPrice(chart: IChartApi, data: PaneData, renderers: PanelRenderers, pane: number): void {
  const price = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  }, pane);
  // IB-067: whitespace bars past the last candle, so the week's upcoming events have slots to sit on
  price.setData([...toCandleData(data.candles.candles), ...futureSlots(data).map((time) => ({ time }))] as never);
  renderers.price = price as ISeriesApi<SeriesType>;
  drawLevels(chart, data, pane);
  // IB-128: an admin's custom levels, price lines across the chart; they live on this series, so a redraw in place
  // (a new series) takes them along. Price lines are not part of the autoscale: a far level never flattens the candles.
  for (const l of customLevelLines(data.customLevels, data.layersOff?.customLevels ?? false)) {
    price.createPriceLine({ price: l.price, color: l.colour, lineWidth: 1, lineStyle: LineStyle.LargeDashed, axisLabelVisible: true, title: l.title });
  }
  drawDivergences(chart, data, 'price', pane);

  // IB-039 §12.5 — liquidations as bubbles ON the price, bucketed to the bar on screen so a
  // cascade reads as one big circle rather than a smear of overlapping dots.
  price.attachPrimitive(renderers.markers);
  renderers.markers.setMarkers(toLiquidationMarkers(data.liquidationEvents, {
    barSeconds: barSeconds(data.timeframe),
  }));

  // IB-129 (alerts design §5): the liquidation and funding alerts, as the library's markers on the candles.
  // They live on this series, so a redraw in place (a new series) takes them along and the old ones go with it.
  renderers.alertMarkers = createSeriesMarkers(price, toAlertMarkers(data.alertMarks ?? [], candleTimes(data), barSeconds(data.timeframe)) as never);
}

const DASH: Record<LevelDash, LineStyle> = { dashed: LineStyle.Dashed, dotted: LineStyle.Dotted, sparse: LineStyle.SparseDotted };

/**
 * The level lines (`levelLines` in prior-levels.ts): thin steps, titled on the price axis. Left out of the
 * pane's autoscale: on 1m the previous week's range can be ten times the day's, and a scale stretched to
 * reach it would flatten the candles; a level off the visible scale is off screen. IB-129: PMH/PML, WO and
 * MO join them, each left out while its legend switch is off (`data.layersOff`).
 */
function drawLevels(chart: IChartApi, data: PaneData, pane: number): void {
  for (const line of levelLines(data.dailyCandles, candleTimes(data), data.timeframe, data.layersOff)) {
    chart.addSeries(LineSeries, {
      color: line.colour, lineWidth: 1, lineStyle: DASH[line.dash], lineType: LineType.WithSteps,
      title: line.title, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => null,
    }, pane).setData(line.points as never);
  }
}

/** The candle times every overlay is placed on: one time-scale slot per bar (time-grid.ts). */
const candleTimes = (data: PaneData): number[] => toCandleData(data.candles.candles).map((c) => c.time);

/**
 * IB-067: the candles' slots and the future ones after them (`future-bars.ts`). Event lines, day
 * separators and the closed and session bands go on these, so they carry on right of the current
 * bar; the previous day/week levels stay on the candles, being about what has traded.
 */
const slotTimes = (data: PaneData): number[] => [...candleTimes(data), ...futureSlots(data)];

/** IB-060: the event lines on the price pane — one definition for the lines and their tooltip. */
export const eventMarks = (data: PaneData): CalendarMark[] =>
  calendarMarks(data.calendarEvents, slotTimes(data), barSeconds(data.timeframe));

/**
 * Day separators and the US-closed bands (weekends, US holidays: IB-060) on every pane up to 4h;
 * on the price pane also the London and New York session bands up to 1h and a line on each bar
 * holding a high-impact USD event. One pane primitive under the series (time-marks.primitive.ts).
 */
function drawTimeMarks(chart: IChartApi, data: PaneData, renderers: PanelRenderers, key: PanelDef['key'], pane: number): void {
  const target = chart.panes()[pane];
  if (!target) return;
  const times = slotTimes(data);
  const step = barSeconds(data.timeframe);
  const lines = showsDaySeparators(data.timeframe) ? daySeparatorTimes(times) : [];
  const sessions = key === 'price' && showsSessions(data.timeframe) ? sessionBands(times, step) : [];
  const bands = [...closedBands(times, data.timeframe, data.calendarEvents), ...sessions];
  const eventLines = key === 'price' ? eventMarks(data).map((m) => m.time) : [];
  if (lines.length > 0 || bands.length > 0 || eventLines.length > 0) {
    const primitive = new TimeMarksPrimitive({ lines, bands, eventLines, eventColour: EVENT_LINE_COLOUR });
    target.attachPrimitive(primitive);
    renderers.paneMarks.push({ pane: target, primitive });
  }
}

/** Any series onto the candle grid: one time-scale slot per bar however many series (time-grid.ts). */
const onGrid = <T extends { time: number }>(points: readonly T[], data: PaneData): T[] =>
  snapToGrid(points, barSeconds(data.timeframe));

function drawOpenInterest(chart: IChartApi, data: PaneData, renderers: PanelRenderers, pane: number): void {
  // Always the renderer's LINE style: an open-interest reading is a snapshot, and its candle style
  // would draw each bar as a flat dash. Attached as '1m' because that is what selects the line.
  if (!renderers.oi.series) renderers.oi.attach(chart, '1m', pane);
  renderers.oi.setData(toOpenInterestPoints(onGrid(data.openInterest, data), data.instrument, data.timeframe));
  drawDivergences(chart, data, 'openInterest', pane);
}

/**
 * IB-110 (V15): the OI divergence lines on the price and OI panes (`oi-divergence-lines.ts`): two points
 * each, teal bullish / red bearish, the dash by kind × repeat (IB-144, `DIVERGENCE_LINE_STYLES`). Out of the
 * autoscale like the levels — a line is between two values the pane already shows, and must never rescale it.
 */
function drawDivergences(chart: IChartApi, data: PaneData, which: 'price' | 'openInterest', pane: number): void {
  const tf = data.divergences ? divergenceTf(data.timeframe) : null;
  if (!tf || !data.divergences) return;
  const strokes = divergenceStrokes(data.divergences, tf).filter((s) => s.pane === which);
  // TL review: OI strokes are in CONTRACTS, on an overlay scale of their own, over a thin contracts line —
  // the pane's main line is USD and would point some strokes the wrong way
  const scale = which === 'openInterest' ? { priceScaleId: OI_CONTRACTS_SCALE } : {};
  if (which === 'openInterest' && strokes.length > 0) {
    const contracts = chart.addSeries(LineSeries, {
      ...scale, color: OI_CONTRACTS_COLOUR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    }, pane);
    contracts.setData(asLine(onGrid(data.openInterest, data).map((p) => ({ time: p.time, value: p.value }))));
    contracts.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0.15 } });
  }
  for (const s of strokes) {
    chart.addSeries(LineSeries, {
      ...scale, color: s.colour, lineWidth: 2, lineStyle: s.lineStyle,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, pointMarkersVisible: true,
      autoscaleInfoProvider: () => null,
    }, pane).setData(s.points as never);
  }
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
  drawTimeMarks(chart, data, renderers, key, pane);
}

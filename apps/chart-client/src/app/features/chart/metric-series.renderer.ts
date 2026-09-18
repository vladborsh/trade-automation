import { signal } from '@angular/core';
import {
  CandlestickSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { AggregateMetricPoint, Timeframe } from '@trade-automation/contracts';
import { isAggregatePoint, type PanelMetricPoint } from '../../core/contracts/panel-metric-point';
import { toMetricCandleData, toMetricLineData } from './chart-data.adapter';
import { formatCompact } from './compact-number.format';
import { METRIC_DOWN_COLOR, METRIC_UP_COLOR, metricSeriesStyle, type MetricSeriesStyle } from './metric-series-style';
import {
  PARTIAL_LINE_COLOR,
  aggregateLineItemsAt,
  seamMarkers,
  splitAggregateLine,
  toAggregateCandleData,
  type SeamMarker,
} from './aggregate-series-data';

export type MetricSeriesApi = ISeriesApi<'Line'> | ISeriesApi<'Candlestick'>;

type Markers = ISeriesMarkersPluginApi<Time>;
/**
 * Line mode has two series (architecture/aggregate-oi.md §1 point 1): `series` = complete bars,
 * solid; `partial` = partial bars, dashed + dimmed. A single-venue panel leaves `partial` empty.
 */
type Drawn =
  | { style: 'line'; series: ISeriesApi<'Line'>; partial: ISeriesApi<'Line'>; markers: Markers; partialMarkers: Markers }
  | { style: 'candles'; series: ISeriesApi<'Candlestick'>; markers: Markers };

const PRICE_FORMAT = { type: 'custom' as const, formatter: formatCompact, minMove: 1 };
const SEAM_MARKER_COLOR = '#c9d1d9';

function toSeriesMarker(m: SeamMarker): SeriesMarker<Time> {
  return { time: (m.time / 1000) as UTCTimestamp, position: 'aboveBar', shape: 'arrowDown', color: SEAM_MARKER_COLOR, text: m.text };
}

/**
 * architecture/chart-layouts.md §11.2 — owns a metric panel's series: a line or candles per
 * `metricSeriesStyle`, swapped in place when the style changes (the panel is not recreated on a
 * timeframe change), plotting the USD notional side of each point. Kept out of `ChartComponent`,
 * which only forwards points and asks for the current (main) series.
 *
 * Aggregate points (architecture/aggregate-oi.md §1) additionally get: per-bar hollow/dimmed
 * partial candles, the complete/partial line split with a break at every seam, and a seam marker
 * on every coverage change — all computed by the pure `aggregate-series-data.ts`.
 */
export class MetricSeriesRenderer {
  private chart: IChartApi | null = null;
  private drawn: Drawn | null = null;

  /** e2e hooks (canvas has no DOM): the seam markers and line breaks last handed to the chart, JSON. */
  readonly seamMarkersAttr = signal<string | null>(null);
  readonly lineBreaksAttr = signal<string | null>(null);

  get series(): MetricSeriesApi | null {
    return this.drawn?.series ?? null;
  }

  attach(chart: IChartApi, tf: Timeframe): MetricSeriesApi {
    this.chart = chart;
    this.drawn = this.create(chart, metricSeriesStyle(tf));
    return this.drawn.series;
  }

  /** Swaps the series if `tf` draws in another style. Returns true on a swap — the caller must `setData` again. */
  setTimeframe(tf: Timeframe): boolean {
    const style = metricSeriesStyle(tf);
    if (!this.chart || !this.drawn || this.drawn.style === style) {
      return false;
    }
    this.remove(this.chart, this.drawn);
    this.drawn = this.create(this.chart, style);
    return true;
  }

  setData(points: readonly PanelMetricPoint[]): void {
    const drawn = this.drawn;
    if (!drawn) {
      return;
    }
    const aggregate = aggregatePoints(points);
    if (drawn.style === 'line') {
      if (aggregate) {
        const split = splitAggregateLine(aggregate);
        drawn.series.setData(split.complete);
        drawn.partial.setData(split.partial);
        this.lineBreaksAttr.set(JSON.stringify(split.breaks));
      } else {
        drawn.series.setData(points.map(toMetricLineData));
        drawn.partial.setData([]);
        this.lineBreaksAttr.set(null);
      }
    } else {
      drawn.series.setData(aggregate ? aggregate.map(toAggregateCandleData) : points.map(toMetricCandleData));
      this.lineBreaksAttr.set(null);
    }
    this.setSeamMarkers(aggregate);
  }

  /** The last point was replaced or appended; `points` is the whole series (seams need neighbours). */
  update(points: readonly PanelMetricPoint[]): void {
    const drawn = this.drawn;
    const last = points[points.length - 1];
    if (!drawn || !last) {
      return;
    }
    const aggregate = aggregatePoints(points);
    if (!aggregate) {
      if (drawn.style === 'line') drawn.series.update(toMetricLineData(last));
      else drawn.series.update(toMetricCandleData(last));
      return;
    }
    const n = aggregate.length;
    if (drawn.style === 'line') {
      // The previous bar's colour depends on this one (transparent before a seam): re-send it first.
      for (const i of n > 1 ? [n - 2, n - 1] : [n - 1]) {
        const items = aggregateLineItemsAt(aggregate, i);
        drawn.series.update(items.complete, i < n - 1);
        drawn.partial.update(items.partial, i < n - 1);
      }
      this.lineBreaksAttr.set(JSON.stringify(splitAggregateLine(aggregate).breaks));
    } else {
      drawn.series.update(toAggregateCandleData(aggregate[n - 1]));
    }
    this.setSeamMarkers(aggregate);
  }

  private setSeamMarkers(aggregate: readonly AggregateMetricPoint[] | null): void {
    const drawn = this.drawn;
    if (!drawn) {
      return;
    }
    const markers = aggregate ? seamMarkers(aggregate) : [];
    if (drawn.style === 'line') {
      // A marker sits on the series that has data at its bar (the other one is whitespace there).
      drawn.markers.setMarkers(markers.filter((m) => m.complete).map(toSeriesMarker));
      drawn.partialMarkers.setMarkers(markers.filter((m) => !m.complete).map(toSeriesMarker));
    } else {
      drawn.markers.setMarkers(markers.map(toSeriesMarker));
    }
    this.seamMarkersAttr.set(aggregate ? JSON.stringify(markers.map(({ time, text }) => ({ time, text }))) : null);
  }

  private remove(chart: IChartApi, drawn: Drawn): void {
    drawn.markers.detach();
    chart.removeSeries(drawn.series);
    if (drawn.style === 'line') {
      drawn.partialMarkers.detach();
      chart.removeSeries(drawn.partial);
    }
  }

  private create(chart: IChartApi, style: MetricSeriesStyle): Drawn {
    if (style === 'line') {
      const series = chart.addSeries(LineSeries, {
        color: METRIC_UP_COLOR,
        lineWidth: 2,
        lastValueVisible: true,
        priceFormat: PRICE_FORMAT,
      });
      const partial = chart.addSeries(LineSeries, {
        color: PARTIAL_LINE_COLOR,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: true,
        priceLineVisible: false,
        priceFormat: PRICE_FORMAT,
      });
      return { style, series, partial, markers: createSeriesMarkers(series, []), partialMarkers: createSeriesMarkers(partial, []) };
    }
    const series = chart.addSeries(CandlestickSeries, {
      upColor: METRIC_UP_COLOR,
      downColor: METRIC_DOWN_COLOR,
      // Borders on (same hue as the body): an aggregate's partial bars are hollow, drawn by border only.
      borderVisible: true,
      borderUpColor: METRIC_UP_COLOR,
      borderDownColor: METRIC_DOWN_COLOR,
      wickUpColor: METRIC_UP_COLOR,
      wickDownColor: METRIC_DOWN_COLOR,
      priceFormat: PRICE_FORMAT,
    });
    return { style, series, markers: createSeriesMarkers(series, []) };
  }
}

function aggregatePoints(points: readonly PanelMetricPoint[]): readonly AggregateMetricPoint[] | null {
  return points.length > 0 && isAggregatePoint(points[0]) ? (points as readonly AggregateMetricPoint[]) : null;
}

import type { CandlestickData, LineData, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import type { AggregateMetricPoint } from '@trade-automation/contracts';
import { toMetricCandleData, toMetricLineData } from './chart-data.adapter';
import { METRIC_DOWN_COLOR, METRIC_UP_COLOR } from './metric-series-style';
import { coverageDiffText } from '../aggregate/coverage-text';

/*
 * architecture/aggregate-oi.md §1 "What the reader sees" — aggregate points → what the metric
 * series draws. Pure; `MetricSeriesRenderer` only hands the results to lightweight-charts.
 */

/** §1 point 1 — partial bars keep the OI hues but hollow and dimmed to this opacity. */
export const PARTIAL_OPACITY = 0.45;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

function withOpacity(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}

/** §1 point 1 — the partial line series: dashed (series option) and dimmed. */
export const PARTIAL_LINE_COLOR = withOpacity(METRIC_UP_COLOR, PARTIAL_OPACITY);

export interface BarStyle {
  color: string;
  borderColor: string;
  wickColor: string;
}

/**
 * §1 point 1 — one candle's colours from `complete` and its direction: complete bars are solid
 * `#58a6ff` / `#f0883e`; partial bars have a transparent body and a border + wick at 45 %.
 */
export function aggregateBarStyle(complete: boolean, up: boolean): BarStyle {
  const hue = up ? METRIC_UP_COLOR : METRIC_DOWN_COLOR;
  if (complete) {
    return { color: hue, borderColor: hue, wickColor: hue };
  }
  const dim = withOpacity(hue, PARTIAL_OPACITY);
  return { color: TRANSPARENT, borderColor: dim, wickColor: dim };
}

/** The USD candle of an aggregate bar with its per-bar style; no notional → whitespace (§11.1). */
export function toAggregateCandleData(point: AggregateMetricPoint): CandlestickData | WhitespaceData {
  const bar = toMetricCandleData(point);
  if (!('open' in bar)) {
    return bar;
  }
  return { ...bar, ...aggregateBarStyle(point.complete, bar.close >= bar.open) };
}

export type LineItem = LineData | WhitespaceData;

export interface AggregateLineItems {
  complete: LineItem;
  partial: LineItem;
}

function drawn(point: AggregateMetricPoint | undefined): boolean {
  return point !== undefined && point.notional !== undefined;
}

/**
 * §1 point 1, line mode — bar `i` split into the two line series: it is data in the series of its
 * completeness (solid = complete, dashed = partial) and whitespace in the other. lightweight-charts
 * draws the segment `i → i+1` in bar `i`'s colour and joins a line across whitespace, so bar `i` is
 * made TRANSPARENT whenever the segment leaving it would cross a seam: the next bar is in the other
 * series, has no USD, or starts a new coverage epoch (partial → partial with a different venue set).
 */
export function aggregateLineItemsAt(points: readonly AggregateMetricPoint[], i: number): AggregateLineItems {
  const point = points[i];
  const time = Math.floor(point.time / 1000) as UTCTimestamp;
  const whitespace: WhitespaceData = { time };
  if (!drawn(point)) {
    return { complete: whitespace, partial: whitespace };
  }
  const next = points[i + 1];
  const breaksAfter = next !== undefined && (!drawn(next) || next.complete !== point.complete || next.coverageStart);
  const item = toMetricLineData(point) as LineData;
  const own: LineItem = breaksAfter ? { ...item, color: TRANSPARENT } : item;
  return point.complete ? { complete: own, partial: whitespace } : { complete: whitespace, partial: own };
}

export interface AggregateLineSeries {
  complete: LineItem[];
  partial: LineItem[];
  /** Times (ms) of bars the line reaches WITHOUT a segment from the previous bar — a visible break. */
  breaks: number[];
}

export function splitAggregateLine(points: readonly AggregateMetricPoint[]): AggregateLineSeries {
  const complete: LineItem[] = [];
  const partial: LineItem[] = [];
  const breaks: number[] = [];
  points.forEach((point, i) => {
    const items = aggregateLineItemsAt(points, i);
    complete.push(items.complete);
    partial.push(items.partial);
    const previous = i > 0 ? (points[i - 1].complete ? complete[i - 1] : partial[i - 1]) : null;
    const joined = previous !== null && 'value' in previous && (previous as LineData).color !== TRANSPARENT;
    if (i > 0 && drawn(point) && !joined) {
      breaks.push(point.time);
    }
  });
  return { complete, partial, breaks };
}

export interface SeamMarker {
  /** Bar time, ms. */
  time: number;
  text: string;
  /** Completeness of the bar the marker sits on — which line series carries it in line mode. */
  complete: boolean;
}

/**
 * §1 point 2 — one marker on every `coverageStart` bar, naming the change vs the previous EMITTED
 * bar (`+Hyperliquid`, `−Hyperliquid`). The first loaded bar has no known predecessor: no marker
 * until an older page supplies one. A `coverageStart` with an unchanged set gets none.
 */
export function seamMarkers(points: readonly AggregateMetricPoint[]): SeamMarker[] {
  const markers: SeamMarker[] = [];
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    if (!point.coverageStart) {
      continue;
    }
    const text = coverageDiffText(points[i - 1].coverage, point.coverage);
    if (text) {
      markers.push({ time: point.time, text, complete: point.complete });
    }
  }
  return markers;
}

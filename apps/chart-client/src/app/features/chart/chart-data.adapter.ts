import type { CandlestickData, LineData, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import type { Candle, MetricPoint } from '@trade-automation/contracts';

/**
 * Candle → CandlestickData (§5.2), time in seconds UTC — lightweight-charts
 * expects UNIX seconds, the wire contract carries ms-epoch (§3.3).
 */
export function toCandlestickData(candle: Candle): CandlestickData {
  return {
    time: Math.floor(candle.openTime / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

export function toCandlestickSeries(candles: readonly Candle[]): CandlestickData[] {
  return candles.map(toCandlestickData);
}

function metricTime(point: MetricPoint): UTCTimestamp {
  return Math.floor(point.time / 1000) as UTCTimestamp;
}

/**
 * architecture/chart-layouts.md §11.1–§11.2 — MetricPoint → one bar of the metric series, same
 * ms → seconds conversion as candles. The panel plots the USD notional side (`notional` for the
 * line, `notionalOhlc` for candles); a point without a notional is whitespace (`{ time }`) — a
 * gap, never a base-unit number drawn on a USD series.
 */
export function toMetricLineData(point: MetricPoint): LineData | WhitespaceData {
  const time = metricTime(point);
  return point.notional === undefined ? { time } : { time, value: point.notional };
}

export function toMetricCandleData(point: MetricPoint): CandlestickData | WhitespaceData {
  const time = metricTime(point);
  const ohlc = point.notionalOhlc;
  return ohlc === undefined ? { time } : { time, open: ohlc.open, high: ohlc.high, low: ohlc.low, close: ohlc.close };
}

/** The value the panel plots as the point's close — what the crosshair follow sits on (§11.2). */
export function metricPlottedClose(point: MetricPoint | undefined): number | undefined {
  return point?.notionalOhlc?.close ?? point?.notional;
}

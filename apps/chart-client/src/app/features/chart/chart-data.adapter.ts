import type { CandlestickData, LineData, UTCTimestamp } from 'lightweight-charts';
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

/** MetricPoint → LineData (§6.6), same ms → seconds conversion as candles. */
export function toLineData(point: MetricPoint): LineData {
  return {
    time: Math.floor(point.time / 1000) as UTCTimestamp,
    value: point.value,
  };
}

export function toLineSeries(points: readonly MetricPoint[]): LineData[] {
  return points.map(toLineData);
}

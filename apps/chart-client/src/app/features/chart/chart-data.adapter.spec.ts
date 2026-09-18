import type { Candle, MetricPoint } from '@trade-automation/contracts';
import { metricPlottedClose, toCandlestickData, toMetricCandleData, toMetricLineData } from './chart-data.adapter';

function point(time: number, extra: Partial<MetricPoint> = {}): MetricPoint {
  return {
    metric: 'openInterest',
    instrument: 'binance:BTCUSDT',
    timeframe: '5m',
    time,
    unit: 'base',
    value: 100,
    ohlc: { open: 99, high: 101, low: 98, close: 100 },
    samples: 1,
    ...extra,
  };
}

const withNotional: Partial<MetricPoint> = {
  notional: 8_000_000_000,
  notionalOhlc: { open: 7_900_000_000, high: 8_100_000_000, low: 7_800_000_000, close: 8_000_000_000 },
  notionalBasis: 'venue',
};

describe('chart-data.adapter', () => {
  it('converts a candle to seconds-scale CandlestickData', () => {
    const candle = { openTime: 60_000, open: 1, high: 2, low: 0.5, close: 1.5 } as Candle;
    expect(toCandlestickData(candle)).toEqual({ time: 60, open: 1, high: 2, low: 0.5, close: 1.5 });
  });

  it('plots the notional as a line value (§11.1)', () => {
    expect(toMetricLineData(point(300_000, withNotional))).toEqual({ time: 300, value: 8_000_000_000 });
  });

  it('plots the notional OHLC as a candle, not the base-unit ohlc (§11.2)', () => {
    expect(toMetricCandleData(point(300_000, withNotional))).toEqual({
      time: 300,
      open: 7_900_000_000,
      high: 8_100_000_000,
      low: 7_800_000_000,
      close: 8_000_000_000,
    });
  });

  it('turns a point without notional into whitespace in both styles', () => {
    expect(toMetricLineData(point(300_000))).toEqual({ time: 300 });
    expect(toMetricCandleData(point(300_000))).toEqual({ time: 300 });
  });

  it('maps a series keeping gaps in place', () => {
    const series = [point(0, withNotional), point(300_000), point(600_000, withNotional)].map(toMetricLineData);
    expect(series.map((d) => ('value' in d ? d.value : null))).toEqual([8_000_000_000, null, 8_000_000_000]);
  });

  it('metricPlottedClose reads the plotted close, not the base value', () => {
    expect(metricPlottedClose(point(0, withNotional))).toBe(8_000_000_000);
    expect(metricPlottedClose(point(0))).toBeUndefined();
    expect(metricPlottedClose(undefined)).toBeUndefined();
  });
});

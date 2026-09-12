import {
  bucketObservations,
  MetricObservation,
  MetricObservationSchema,
  MetricPoint,
  MetricPointSchema,
  metricKey,
  Timeframe,
  TIMEFRAME_MS,
  WsMetricMessageSchema,
} from '../src';

describe('metric contracts round-trip (architecture/chart-layouts.md §4.2)', () => {
  it('parses and re-serializes a MetricObservation identically', () => {
    const observation: MetricObservation = {
      metric: 'openInterest',
      instrument: 'binance:BTCUSDT',
      time: 1_726_000_000_000,
      value: 12345.6,
      notional: 987_654_321,
    };
    const parsed = MetricObservationSchema.parse(observation);
    expect(parsed).toEqual(observation);
    expect(MetricObservationSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(observation);
  });

  it('accepts a MetricObservation without `notional` (live snapshot)', () => {
    const observation = {
      metric: 'openInterest',
      instrument: 'binance:BTCUSDT',
      time: 1_726_000_000_000,
      value: 12345.6,
    };
    expect(MetricObservationSchema.parse(observation)).toEqual(observation);
  });

  it('parses and re-serializes a MetricPoint (extends MetricObservation with timeframe)', () => {
    const point: MetricPoint = {
      metric: 'openInterest',
      instrument: 'binance:BTCUSDT',
      timeframe: '1m',
      time: 1_726_000_000_000,
      value: 12345.6,
      notional: 987_654_321,
    };
    const parsed = MetricPointSchema.parse(JSON.parse(JSON.stringify(point)));
    expect(parsed).toEqual(point);

    const frame = WsMetricMessageSchema.parse({ type: 'metric', point });
    expect(frame.point).toEqual(point);
  });

  it('rejects a MetricObservation with a negative value', () => {
    expect(() =>
      MetricObservationSchema.parse({
        metric: 'openInterest',
        instrument: 'binance:BTCUSDT',
        time: 1,
        value: -1,
      }),
    ).toThrow();
  });

  it('metricKey composes a stable identity string', () => {
    expect(metricKey('openInterest', 'binance:BTCUSDT', '1m', 60_000)).toBe(
      'openInterest|binance:BTCUSDT|1m|60000',
    );
  });
});

describe('bucketObservations (architecture/chart-layouts.md §4.2)', () => {
  const base = { metric: 'openInterest' as const, instrument: 'binance:BTCUSDT' as const };

  it('buckets ascending observations to the timeframe grid, keeping the last observation per bucket', () => {
    const obs: MetricObservation[] = [
      { ...base, time: 0, value: 100 },
      { ...base, time: 20_000, value: 110 },
      { ...base, time: 61_000, value: 120 },
      { ...base, time: 90_000, value: 130 },
    ];
    const points = bucketObservations(obs, '1m');
    expect(points).toEqual([
      { ...base, timeframe: '1m', time: 0, value: 110, notional: undefined },
      { ...base, timeframe: '1m', time: 60_000, value: 130, notional: undefined },
    ]);
  });

  it('produces one bucket spanning a day boundary correctly for a coarse timeframe', () => {
    const dayMs = 24 * 60 * 60_000;
    const obs: MetricObservation[] = [
      { ...base, time: dayMs - 1000, value: 1 },
      { ...base, time: dayMs + 1000, value: 2 },
    ];
    const points = bucketObservations(obs, '1d');
    expect(points).toEqual([
      { ...base, timeframe: '1d', time: 0, value: 1, notional: undefined },
      { ...base, timeframe: '1d', time: dayMs, value: 2, notional: undefined },
    ]);
  });

  it('returns an empty array for no observations', () => {
    expect(bucketObservations([], '1m')).toEqual([]);
  });

  it('buckets correctly at every timeframe (architecture/chart-layouts.md §9 SE-4)', () => {
    const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
    for (const tf of timeframes) {
      const bucketMs = TIMEFRAME_MS[tf];
      const obs: MetricObservation[] = [
        { ...base, time: 0, value: 1 },
        { ...base, time: bucketMs - 1, value: 2 }, // same bucket as time 0, should replace
        { ...base, time: bucketMs, value: 3 }, // next bucket
        { ...base, time: bucketMs + Math.floor(bucketMs / 2), value: 4 }, // same bucket as `bucketMs`
      ];
      const points = bucketObservations(obs, tf);
      expect(points).toEqual([
        { ...base, timeframe: tf, time: 0, value: 2, notional: undefined },
        { ...base, timeframe: tf, time: bucketMs, value: 4, notional: undefined },
      ]);
    }
  });

  it('preserves notional through bucketing when present on the winning observation', () => {
    const obs: MetricObservation[] = [
      { ...base, time: 0, value: 100, notional: 1000 },
      { ...base, time: 30_000, value: 105 }, // last-in-bucket, no notional
    ];
    const points = bucketObservations(obs, '1m');
    expect(points).toEqual([{ ...base, timeframe: '1m', time: 0, value: 105, notional: undefined }]);
  });
});

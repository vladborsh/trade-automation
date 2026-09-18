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
      unit: 'base',
      notional: 987_654_321,
      notionalBasis: 'venue',
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
      unit: 'base',
    };
    expect(MetricObservationSchema.parse(observation)).toEqual(observation);
  });

  it('requires `unit` (§11.1 — every mapper writes it)', () => {
    expect(() =>
      MetricObservationSchema.parse({ metric: 'openInterest', instrument: 'binance:BTCUSDT', time: 1, value: 1 }),
    ).toThrow();
  });

  it('rejects an unknown unit or notionalBasis', () => {
    const base = { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: 1, value: 1 };
    expect(() => MetricObservationSchema.parse({ ...base, unit: 'usd' })).toThrow();
    expect(() => MetricObservationSchema.parse({ ...base, unit: 'base', notional: 1, notionalBasis: 'guess' })).toThrow();
  });

  it('parses and re-serializes a MetricPoint (§11.2 — ohlc, notionalOhlc, samples)', () => {
    const point: MetricPoint = {
      metric: 'openInterest',
      instrument: 'binance:BTCUSDT',
      timeframe: '1m',
      time: 1_726_000_000_000,
      value: 12345.6,
      unit: 'base',
      ohlc: { open: 12000, high: 12400, low: 11900, close: 12345.6 },
      notional: 987_654_321,
      notionalOhlc: { open: 960_000_000, high: 990_000_000, low: 950_000_000, close: 987_654_321 },
      notionalBasis: 'venue',
      samples: 3,
    };
    const parsed = MetricPointSchema.parse(JSON.parse(JSON.stringify(point)));
    expect(parsed).toEqual(point);

    const frame = WsMetricMessageSchema.parse({ type: 'metric', point });
    expect(frame.point).toEqual(point);
  });

  it('rejects a MetricPoint without ohlc or with zero samples', () => {
    const point = {
      metric: 'openInterest',
      instrument: 'binance:BTCUSDT',
      timeframe: '5m',
      time: 0,
      value: 1,
      unit: 'base',
      ohlc: { open: 1, high: 1, low: 1, close: 1 },
      samples: 1,
    };
    expect(MetricPointSchema.parse(point)).toEqual(point);
    expect(() => MetricPointSchema.parse({ ...point, ohlc: undefined })).toThrow();
    expect(() => MetricPointSchema.parse({ ...point, samples: 0 })).toThrow();
  });

  it('rejects a MetricObservation with a negative value', () => {
    expect(() =>
      MetricObservationSchema.parse({
        metric: 'openInterest',
        instrument: 'binance:BTCUSDT',
        time: 1,
        value: -1,
        unit: 'base',
      }),
    ).toThrow();
  });

  it('metricKey composes a stable identity string', () => {
    expect(metricKey('openInterest', 'binance:BTCUSDT', '1m', 60_000)).toBe(
      'openInterest|binance:BTCUSDT|1m|60000',
    );
  });
});

describe('bucketObservations (architecture/chart-layouts.md §4.2, §11.2)', () => {
  const base = { metric: 'openInterest' as const, instrument: 'binance:BTCUSDT' as const, unit: 'base' as const };
  const ohlc = (open: number, high: number, low: number, close: number) => ({ open, high, low, close });
  const M = 60_000;

  it('buckets ascending observations to the timeframe grid, keeping the last observation per bucket', () => {
    const obs: MetricObservation[] = [
      { ...base, time: 0, value: 100 },
      { ...base, time: 20_000, value: 110 },
      { ...base, time: 61_000, value: 120 },
      { ...base, time: 90_000, value: 130 },
    ];
    const points = bucketObservations(obs, '1m');
    // 1m grain: one sample per 1 m bucket (last-in-bucket); open = previous close when adjacent.
    expect(points).toEqual([
      { ...base, timeframe: '1m', time: 0, value: 110, ohlc: ohlc(110, 110, 110, 110), samples: 1 },
      { ...base, timeframe: '1m', time: 60_000, value: 130, ohlc: ohlc(110, 130, 110, 130), samples: 1 },
    ]);
  });

  it('produces one bucket spanning a day boundary correctly for a coarse timeframe', () => {
    const dayMs = 24 * 60 * M;
    const obs: MetricObservation[] = [
      { ...base, time: dayMs - 1000, value: 1 },
      { ...base, time: dayMs + 1000, value: 2 },
    ];
    const points = bucketObservations(obs, '1d');
    expect(points).toEqual([
      { ...base, timeframe: '1d', time: 0, value: 1, ohlc: ohlc(1, 1, 1, 1), samples: 1 },
      { ...base, timeframe: '1d', time: dayMs, value: 2, ohlc: ohlc(1, 2, 1, 2), samples: 1 },
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
      expect(points.map(({ timeframe, time, value }) => ({ timeframe, time, value }))).toEqual([
        { timeframe: tf, time: 0, value: 2 },
        { timeframe: tf, time: bucketMs, value: 4 },
      ]);
      expect(points[1].ohlc.open).toBe(2); // open = previous bucket's close
      expect(points[1].ohlc.close).toBe(4);
    }
  });

  it('preserves notional through bucketing when present on the winning observation', () => {
    const obs: MetricObservation[] = [
      { ...base, time: 0, value: 100, notional: 1000 },
      { ...base, time: 30_000, value: 105 }, // last-in-bucket, no notional
    ];
    const points = bucketObservations(obs, '1m');
    expect(points).toEqual([{ ...base, timeframe: '1m', time: 0, value: 105, ohlc: ohlc(105, 105, 105, 105), samples: 1 }]);
    expect(points[0].notional).toBeUndefined();
    expect(points[0].notionalOhlc).toBeUndefined();
  });

  it('carries unit and notionalBasis from the winning observation', () => {
    const obs: MetricObservation[] = [
      { ...base, time: 0, value: 100 },
      { ...base, time: 30_000, value: 105, notional: 1050, notionalBasis: 'venue' },
      { ...base, time: 60_000, value: 7, unit: 'contracts' },
    ];
    const points = bucketObservations(obs, '1m');
    expect(points[0]).toStrictEqual({
      ...base,
      timeframe: '1m',
      time: 0,
      value: 105,
      ohlc: ohlc(105, 105, 105, 105),
      notional: 1050,
      notionalOhlc: ohlc(1050, 1050, 1050, 1050),
      notionalBasis: 'venue',
      samples: 1,
    });
    expect(points[1].unit).toBe('contracts');
    expect(points[1].notionalBasis).toBeUndefined();
  });

  it('reduces 1 m live-tip snapshots to one sample per 5 m sub-bucket (§11.2 rule 1)', () => {
    // 15 minutes of 1 m snapshots, values 0..14; each 5 m sub-bucket keeps its last one: 4, 9, 14.
    const obs: MetricObservation[] = Array.from({ length: 15 }, (_, i) => ({ ...base, time: i * M + 2000, value: 100 + i }));
    const [point] = bucketObservations(obs, '15m');
    expect(point.samples).toBe(3);
    expect(point.ohlc).toEqual(ohlc(104, 114, 104, 114));

    // At 5 m every bucket holds exactly one sample, like a history bucket.
    const five = bucketObservations(obs, '5m');
    expect(five.map((p) => p.samples)).toEqual([1, 1, 1]);
    expect(five.map((p) => p.ohlc)).toEqual([ohlc(104, 104, 104, 104), ohlc(104, 109, 104, 109), ohlc(109, 114, 109, 114)]);
  });

  it('the forming 5 m sub-bucket\'s latest snapshot is the live close', () => {
    const obs: MetricObservation[] = [
      { ...base, time: 0, value: 100 }, // history row
      { ...base, time: 5 * M, value: 110 }, // history row
      { ...base, time: 6 * M + 2000, value: 111 },
      { ...base, time: 7 * M + 2000, value: 108 }, // forming sub-bucket, latest
    ];
    const [point] = bucketObservations(obs, '15m');
    expect(point.samples).toBe(2);
    expect(point.ohlc).toEqual(ohlc(100, 108, 100, 108));
  });

  it('open = previous bucket\'s close; high/low include the open (§11.2 rule 2)', () => {
    const obs: MetricObservation[] = [
      { ...base, time: 0, value: 100 },
      { ...base, time: 15 * M, value: 90 },
      { ...base, time: 20 * M, value: 95 },
      { ...base, time: 25 * M, value: 94 },
    ];
    const points = bucketObservations(obs, '15m');
    // Second bucket's samples are 90, 95, 94 — its high comes from the open (100), not a sample.
    expect(points[1].ohlc).toEqual(ohlc(100, 100, 90, 94));

    // 5 m: body = change since the previous reading, no wicks.
    const five = bucketObservations(obs, '5m');
    expect(five[2].ohlc).toEqual(ohlc(90, 95, 90, 95));
  });

  it('open = first sample when the preceding bucket is missing (gap)', () => {
    const obs: MetricObservation[] = [
      { ...base, time: 0, value: 100 },
      { ...base, time: 30 * M, value: 80 }, // 15m bucket at 15 min is empty
      { ...base, time: 35 * M, value: 85 },
    ];
    const points = bucketObservations(obs, '15m');
    expect(points.map((p) => p.time)).toEqual([0, 30 * M]);
    expect(points[1].ohlc).toEqual(ohlc(80, 85, 80, 85));
  });

  it('builds the notional OHLC only over samples that carry a notional', () => {
    const obs: MetricObservation[] = [
      { ...base, time: 0, value: 100, notional: 1000, notionalBasis: 'venue' },
      { ...base, time: 15 * M, value: 101, notional: 1020, notionalBasis: 'venue' },
      { ...base, time: 20 * M, value: 150 }, // no notional (stale tip price)
      { ...base, time: 25 * M, value: 102, notional: 990, notionalBasis: 'derived' },
    ];
    const points = bucketObservations(obs, '15m');
    expect(points[1].ohlc).toEqual(ohlc(100, 150, 100, 102));
    expect(points[1].notionalOhlc).toEqual(ohlc(1000, 1020, 990, 990));
    expect(points[1].notional).toBe(990);
    expect(points[1].notionalBasis).toBe('derived');
    expect(points[1].samples).toBe(3);
  });

  it('a bucket with no notional sample has no notionalOhlc, and the next bucket opens at its first notional sample', () => {
    const obs: MetricObservation[] = [
      { ...base, time: 0, value: 100 },
      { ...base, time: 5 * M, value: 101, notional: 1010, notionalBasis: 'venue' },
    ];
    const points = bucketObservations(obs, '5m');
    expect(points[0].notionalOhlc).toBeUndefined();
    expect(points[0].notional).toBeUndefined();
    expect(points[1].ohlc).toEqual(ohlc(100, 101, 100, 101));
    expect(points[1].notionalOhlc).toEqual(ohlc(1010, 1010, 1010, 1010));
  });

  it('1 m timeframe: no 5 m reduction — every 1 m bucket keeps its own reading', () => {
    const obs: MetricObservation[] = Array.from({ length: 5 }, (_, i) => ({ ...base, time: i * M + 2000, value: 100 + i }));
    const points = bucketObservations(obs, '1m');
    expect(points.map((p) => p.value)).toEqual([100, 101, 102, 103, 104]);
    expect(points.every((p) => p.samples === 1)).toBe(true);
  });

  it('opens a day bucket at the previous day\'s close across the day boundary', () => {
    const dayMs = 24 * 60 * M;
    const obs: MetricObservation[] = [
      { ...base, time: dayMs - 5 * M, value: 50 },
      { ...base, time: dayMs, value: 55 },
      { ...base, time: dayMs + 5 * M, value: 45 },
    ];
    const points = bucketObservations(obs, '1d');
    expect(points[1]).toEqual(expect.objectContaining({ time: dayMs, ohlc: ohlc(50, 55, 45, 45), samples: 2 }));
  });
});

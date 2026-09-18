import {
  AggregateMetricPoint,
  AggregateMetricPointSchema,
  MetricObservation,
  MetricSource,
  TIMEFRAME_MS,
  aggregateObservations,
} from '../src';

/** architecture/aggregate-oi.md §1 — rules C1–C6 of the cross-venue aggregate. */

const M5 = TIMEFRAME_MS['5m'];
const T0 = 1_789_228_800_000; // 2026-09-12T16:00Z, aligned to 1 h

const BINANCE: MetricSource = { id: 'binance:BTCUSDT', venue: 'binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT' };
const BYBIT: MetricSource = { id: 'bybit:BTCUSDT', venue: 'bybit', symbol: 'BTCUSDT', quoteCurrency: 'USDT' };
const HL: MetricSource = { id: 'hyperliquid:BTC', venue: 'hyperliquid', symbol: 'BTC', quoteCurrency: 'USDC' };
const ALL = [BINANCE.id, BYBIT.id, HL.id];

function obs(source: MetricSource, time: number, value: number, notional?: number): MetricObservation {
  const o: MetricObservation = { metric: 'openInterest', instrument: source.id, time, value, unit: 'base' };
  if (notional !== undefined) {
    o.notional = notional;
    o.notionalBasis = 'venue';
  }
  return o;
}

/** One observation per 5 m slot `i` in `slots`, value = base + i (notional = 10 × value). */
function series(source: MetricSource, slots: readonly number[], base: number, notional = true): MetricObservation[] {
  return slots.map((i) => obs(source, T0 + i * M5, base + i, notional ? (base + i) * 10 : undefined));
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k);

function agg(
  members: [MetricSource, MetricObservation[]][],
  tf: Parameters<typeof aggregateObservations>[2] = '5m',
  convention: Parameters<typeof aggregateObservations>[1] = 'one-sided',
): AggregateMetricPoint[] {
  const points = aggregateObservations(
    members.map(([source, observations]) => ({ source, observations })),
    convention,
    tf,
    'btc-perp-oi',
  );
  for (const p of points) AggregateMetricPointSchema.parse(p); // every point honours the contract
  return points;
}

const at = (points: AggregateMetricPoint[], slot: number) => points.find((p) => p.time === T0 + slot * M5);

describe('aggregateObservations (architecture/aggregate-oi.md §1)', () => {
  it('C2: sums present members, sorted coverage, members[] at the closing sample', () => {
    const points = agg([
      [HL, series(HL, [0], 300)],
      [BINANCE, series(BINANCE, [0], 100)],
      [BYBIT, series(BYBIT, [0], 200)],
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      aggregate: 'btc-perp-oi',
      metric: 'openInterest',
      unit: 'base',
      value: 600,
      notional: 6000,
      coverage: ALL,
      complete: true,
      coverageStart: true, // first bucket of the series
    });
    expect(points[0].members).toEqual([
      { source: BINANCE.id, value: 100, notional: 1000 },
      { source: BYBIT.id, value: 200, notional: 2000 },
      { source: HL.id, value: 300, notional: 3000 },
    ]);
  });

  it('a venue starting mid-series is a seam: coverageStart, own open, no body across it', () => {
    const points = agg([
      [BINANCE, series(BINANCE, range(0, 10), 100)],
      [BYBIT, series(BYBIT, range(0, 10), 200)],
      [HL, series(HL, range(5, 10), 1000)],
    ]);
    expect(points).toHaveLength(10);
    const before = at(points, 4)!;
    const seam = at(points, 5)!;
    const after = at(points, 6)!;
    expect(before).toMatchObject({ coverage: [BINANCE.id, BYBIT.id], complete: false, coverageStart: false });
    expect(seam).toMatchObject({ coverage: ALL, complete: true, coverageStart: true });
    // Own first sample, never the partial epoch's close: the +HL jump is not a candle body.
    expect(seam.ohlc.open).toBe(seam.ohlc.close);
    expect(seam.ohlc.low).toBeGreaterThan(before.ohlc.high);
    expect(after.coverageStart).toBe(false);
    expect(after.ohlc.open).toBe(seam.ohlc.close);
    // marker-worthy: coverage differs from the previous emitted bar
    expect(seam.coverage).not.toEqual(before.coverage);
  });

  it.each([1, 2])('C3: a %i-slot blip of one venue is dropped, never drawn as a dip', (width) => {
    const hlSlots = range(0, 12).filter((i) => i < 5 || i >= 5 + width);
    const points = agg([
      [BINANCE, series(BINANCE, range(0, 12), 100)],
      [BYBIT, series(BYBIT, range(0, 12), 200)],
      [HL, series(HL, hlSlots, 1000)],
    ]);
    expect(points).toHaveLength(12 - width);
    for (let i = 5; i < 5 + width; i++) expect(at(points, i)).toBeUndefined();
    expect(points.every((p) => p.complete)).toBe(true);
    // Values keep rising: no point below its predecessor.
    for (let k = 1; k < points.length; k++) expect(points[k].ohlc.low).toBeGreaterThanOrEqual(points[k - 1].ohlc.close);
  });

  it('C3: a 3-slot outage is kept as a partial epoch, bounded by seams', () => {
    const points = agg([
      [BINANCE, series(BINANCE, range(0, 12), 100)],
      [BYBIT, series(BYBIT, range(0, 12), 200)],
      [HL, series(HL, range(0, 12).filter((i) => i < 5 || i >= 8), 1000)],
    ]);
    expect(points).toHaveLength(12);
    expect(at(points, 5)).toMatchObject({ coverage: [BINANCE.id, BYBIT.id], complete: false, coverageStart: true });
    expect(at(points, 6)).toMatchObject({ complete: false, coverageStart: false });
    expect(at(points, 7)).toMatchObject({ complete: false, coverageStart: false });
    expect(at(points, 8)).toMatchObject({ complete: true, coverageStart: true });
    expect(at(points, 8)!.ohlc.open).toBe(at(points, 8)!.ohlc.close);
  });

  it('C3 right edge: a forming slot only some venues reported is withheld until it is superseded or reaches K', () => {
    const base: [MetricSource, MetricObservation[]][] = [
      [BINANCE, series(BINANCE, range(0, 6), 100)],
      [BYBIT, series(BYBIT, range(0, 6), 200)],
      [HL, series(HL, range(0, 5), 1000)],
    ];
    const forming = agg(base);
    expect(forming).toHaveLength(5);
    expect(at(forming, 5)).toBeUndefined();

    // HL's poll lands → the slot appears, complete.
    const landed = agg([base[0], base[1], [HL, series(HL, range(0, 6), 1000)]]);
    expect(at(landed, 5)).toMatchObject({ complete: true, coverageStart: false });

    // HL stays away for K slots → a real outage, emitted as a partial epoch.
    const outage = agg([
      [BINANCE, series(BINANCE, range(0, 8), 100)],
      [BYBIT, series(BYBIT, range(0, 8), 200)],
      base[2],
    ]);
    expect(outage.map((p) => p.complete)).toEqual([true, true, true, true, true, false, false, false]);
  });

  it("C2/§2: 'as-published' doubles only the Bybit leg", () => {
    const members: [MetricSource, MetricObservation[]][] = [
      [BINANCE, series(BINANCE, [0], 100)],
      [BYBIT, series(BYBIT, [0], 200)],
      [HL, series(HL, [0], 300)],
    ];
    const oneSided = agg(members, '5m', 'one-sided')[0];
    const published = agg(members, '5m', 'as-published')[0];
    expect(oneSided.value).toBe(600);
    expect(published.value).toBe(800);
    expect(published.notional).toBe(8000);
    expect(published.members).toEqual([
      { source: BINANCE.id, value: 100, notional: 1000 },
      { source: BYBIT.id, value: 400, notional: 4000 },
      { source: HL.id, value: 300, notional: 3000 },
    ]);
  });

  it('C2: a leg without notional leaves the slot with a value but no notional (never a partial USD sum)', () => {
    const points = agg([
      [BINANCE, series(BINANCE, [0, 1], 100)],
      [BYBIT, series(BYBIT, [0, 1], 200)],
      [HL, [obs(HL, T0, 300, 3000), obs(HL, T0 + M5, 301)]],
    ]);
    expect(at(points, 0)!.notional).toBe(6000);
    expect(at(points, 1)!.value).toBe(100 + 1 + 200 + 1 + 301);
    expect(at(points, 1)!.notional).toBeUndefined();
    expect(at(points, 1)!.notionalOhlc).toBeUndefined();
    expect(at(points, 1)!.members.find((m) => m.source === HL.id)).toEqual({ source: HL.id, value: 301 });
  });

  it('C1 on 1m: grain is 1 m, last-in-slot per member', () => {
    const M1 = TIMEFRAME_MS['1m'];
    const points = agg(
      [
        [BINANCE, [obs(BINANCE, T0 + 5_000, 100), obs(BINANCE, T0 + 50_000, 101), obs(BINANCE, T0 + M1 + 1_000, 102)]],
        [BYBIT, [obs(BYBIT, T0 + 2_000, 200), obs(BYBIT, T0 + M1 + 3_000, 201)]],
      ],
      '1m',
    );
    expect(points.map((p) => [p.time, p.value, p.samples])).toEqual([
      [T0, 301, 1],
      [T0 + M1, 303, 1],
    ]);
    expect(points[1].ohlc.open).toBe(301);
    expect(points[1].coverageStart).toBe(false);
  });

  it('C4/C5: a 1 h bucket spanning a seam uses only the samples after it, and starts an epoch', () => {
    // HL joins at 16:30: slots 0-5 are Binance+Bybit, slots 6-11 are complete.
    const points = agg(
      [
        [BINANCE, series(BINANCE, range(0, 24), 100)],
        [BYBIT, series(BYBIT, range(0, 24), 200)],
        [HL, series(HL, range(6, 24), 1000)],
      ],
      '1h',
    );
    expect(points).toHaveLength(2);
    const [first, second] = points;
    expect(first).toMatchObject({ time: T0, coverage: ALL, complete: true, coverageStart: true, samples: 6 });
    const firstComplete = 100 + 6 + 200 + 6 + 1000 + 6;
    expect(first.ohlc.open).toBe(firstComplete);
    expect(first.ohlc.low).toBe(firstComplete); // no partial-epoch sample inside the body
    expect(second).toMatchObject({ coverageStart: false, samples: 12 });
    expect(second.ohlc.open).toBe(first.ohlc.close);
  });

  it('C4: a bucket never joins two separate stretches of the same coverage', () => {
    // complete 0-2, HL out 3-5 (outage, K=3), complete 6-11: the 1 h bucket keeps only 6-11.
    const points = agg(
      [
        [BINANCE, series(BINANCE, range(0, 12), 100)],
        [BYBIT, series(BYBIT, range(0, 12), 200)],
        [HL, series(HL, [0, 1, 2, ...range(6, 12)], 1000)],
      ],
      '1h',
    );
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ complete: true, coverageStart: true, samples: 6 });
  });

  it('members arriving unsorted in time give the same points as sorted ones', () => {
    const sorted: [MetricSource, MetricObservation[]][] = [
      [BINANCE, series(BINANCE, range(0, 10), 100)],
      [BYBIT, series(BYBIT, range(0, 10), 200)],
      [HL, series(HL, range(3, 10), 1000)],
    ];
    const shuffled = sorted.map(([s, o]) => [s, [...o].reverse()] as [MetricSource, MetricObservation[]]).reverse();
    expect(agg(shuffled, '15m')).toEqual(agg(sorted, '15m'));
    // last-in-slot is by time, not by arrival
    const lastWins = agg([
      [BINANCE, [obs(BINANCE, T0 + 60_000, 102), obs(BINANCE, T0, 100)]],
      [BYBIT, [obs(BYBIT, T0, 200)]],
    ]);
    expect(lastWins[0].value).toBe(302);
  });

  it('returns [] when no member has observations', () => {
    expect(agg([[BINANCE, []], [BYBIT, []]])).toEqual([]);
  });
});

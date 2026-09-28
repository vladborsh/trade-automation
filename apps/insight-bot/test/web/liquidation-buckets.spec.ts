import { bucketLiquidations, bucketMs, floorTo, topLiquidations, type LiquidationRow } from '../../src/web/series/liquidation-buckets';

/**
 * IB-031 — the liquidation histogram's rules. The pane's job is to show which side was
 * liquidated and when, so the two things that must never happen are summing the sides and
 * closing up empty buckets.
 */

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);
const row = (offsetMs: number, side: 'long' | 'short', notional: number): LiquidationRow => ({ ts: T0 + offsetMs, side, notional });

describe('bucketLiquidations', () => {
  it('keeps long and short apart — summing them would hide the cascade direction', () => {
    const bars = bucketLiquidations([row(0, 'long', 100), row(1000, 'short', 40)], '1m', T0, T0 + 60_000);
    expect(bars).toEqual([{ time: T0 / 1000, long: 100, short: 40, events: 2 }]);
  });

  it('emits EMPTY buckets as zeros rather than omitting them', () => {
    // closing the gaps compresses quiet hours and makes a cascade look like normal activity
    const bars = bucketLiquidations([row(0, 'long', 10)], '1m', T0, T0 + 5 * 60_000);
    expect(bars).toHaveLength(5);
    expect(bars.slice(1).every((b) => b.long === 0 && b.short === 0 && b.events === 0)).toBe(true);
  });

  it('buckets by the requested size', () => {
    const rows = [row(0, 'long', 1), row(60_000, 'long', 2), row(14 * 60_000, 'short', 3)];
    expect(bucketLiquidations(rows, '15m', T0, T0 + 15 * 60_000)).toEqual([
      { time: T0 / 1000, long: 3, short: 3, events: 3 },
    ]);
    expect(bucketMs('1h')).toBe(3_600_000);
  });

  it('aligns buckets to the clock, not to the range start', () => {
    // a range starting at 12:00:30 must still bucket on the minute, or every chart's bars
    // land at different offsets depending on when the page was opened
    const bars = bucketLiquidations([row(0, 'long', 5)], '1m', T0 + 30_000, T0 + 90_000);
    expect(bars[0].time).toBe(T0 / 1000);
    expect(floorTo(T0 + 30_000, 60_000)).toBe(T0);
  });

  it('ignores rows outside the range instead of piling them onto the edge bar', () => {
    const rows = [row(-60_000, 'long', 999), row(0, 'long', 1), row(120_000, 'short', 999)];
    const bars = bucketLiquidations(rows, '1m', T0, T0 + 60_000);
    expect(bars).toEqual([{ time: T0 / 1000, long: 1, short: 0, events: 1 }]);
  });

  it('counts events separately from notional — one whale is not a cascade', () => {
    const bars = bucketLiquidations([row(0, 'long', 1_000_000), row(1, 'long', 5), row(2, 'long', 5)], '1m', T0, T0 + 60_000);
    expect(bars[0]).toMatchObject({ long: 1_000_010, events: 3 });
  });

  it('returns buckets in time order', () => {
    const bars = bucketLiquidations([row(120_000, 'long', 1), row(0, 'short', 2)], '1m', T0, T0 + 180_000);
    expect(bars.map((b) => b.time)).toEqual([T0 / 1000, T0 / 1000 + 60, T0 / 1000 + 120]);
  });

  it('an empty window is an empty array, not an error', () => {
    expect(bucketLiquidations([], '1m', T0, T0)).toEqual([]);
  });
});

describe('topLiquidations', () => {
  it('returns the largest first', () => {
    const rows = [{ notional: 5 }, { notional: 100 }, { notional: 50 }];
    expect(topLiquidations(rows, 2)).toEqual([{ notional: 100 }, { notional: 50 }]);
  });

  it('does not mutate its input', () => {
    const rows = [{ notional: 1 }, { notional: 2 }];
    topLiquidations(rows, 2);
    expect(rows[0].notional).toBe(1);
  });

  it('copes with n larger than the input, and with n of 0', () => {
    expect(topLiquidations([{ notional: 1 }], 50)).toHaveLength(1);
    expect(topLiquidations([{ notional: 1 }], 0)).toEqual([]);
  });
});

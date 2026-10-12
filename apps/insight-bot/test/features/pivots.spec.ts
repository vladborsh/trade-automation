import {
  highestPivotHigh, impulseLow, lowestPivotLow, pivotHighs, pivotLows, type PivotBar,
} from '../../src/features/math/pivots';

/** IB-015 §8.2 — 3-bar pivots behind `structure.*`. */

const M = 60_000;
const T0 = Date.UTC(2026, 9, 1, 0, 0, 0); // a UTC midnight, so a 15m boundary too
const bar = (i: number, high: number, low: number): PivotBar => ({ time: T0 + i * 15 * M, high, low });

describe('pivotHighs / pivotLows', () => {
  it('finds a bar strictly higher than both neighbours', () => {
    const bars = [bar(0, 10, 5), bar(1, 12, 6), bar(2, 11, 7)];
    expect(pivotHighs(bars).map((p) => p.price)).toEqual([12]);
    expect(pivotHighs(bars)[0].time).toBe(T0 + 15 * M);
  });

  it('REQUIRES STRICTLY higher on both sides, so a flat run marks nothing', () => {
    // With `>=` every bar of an equal run would be a pivot and the "swing extreme" would be
    // whichever one came last — an arbitrary choice presented as a measurement.
    expect(pivotHighs([bar(0, 10, 1), bar(1, 10, 1), bar(2, 10, 1)])).toEqual([]);
    expect(pivotLows([bar(0, 10, 1), bar(1, 10, 1), bar(2, 10, 1)])).toEqual([]);
  });

  it('never marks the first or last bar, which have only one neighbour', () => {
    const rising = [bar(0, 1, 0), bar(1, 2, 1), bar(2, 3, 2)];
    expect(pivotHighs(rising)).toEqual([]); // the highest bar is last: no pivot in this window
    expect(pivotLows(rising)).toEqual([]);
  });

  it('finds several pivots in time order', () => {
    const bars = [bar(0, 5, 1), bar(1, 9, 2), bar(2, 4, 0), bar(3, 8, 3), bar(4, 2, 1)];
    expect(pivotHighs(bars).map((p) => p.price)).toEqual([9, 8]);
    expect(pivotLows(bars).map((p) => p.price)).toEqual([0]);
  });
});

describe('highestPivotHigh / lowestPivotLow', () => {
  it('picks the extreme among the pivots, not among all bars', () => {
    // bar 4 is the highest bar in the window but is not a pivot (it is the last bar).
    const bars = [bar(0, 5, 1), bar(1, 9, 2), bar(2, 4, 0), bar(3, 7, 3), bar(4, 99, 50)];
    expect(highestPivotHigh(bars)?.price).toBe(9);
    expect(lowestPivotLow(bars)?.price).toBe(0);
  });

  it('is NULL for a monotonic window rather than reporting its last bar', () => {
    // A window that only rose has no swing high in it; naming one would claim a structure that
    // is not there, which is the §8.2 keys' whole purpose.
    const rising = Array.from({ length: 10 }, (_, i) => bar(i, i, i - 1));
    expect(highestPivotHigh(rising)).toBeNull();
    expect(lowestPivotLow(rising)).toBeNull();
  });
});

describe('impulseLow', () => {
  it('is the last swing low BEFORE the window high', () => {
    //                     idx0     idx1     idx2    idx3     idx4(high)  idx5
    const bars = [bar(0, 5, 3), bar(1, 4, 1), bar(2, 6, 2), bar(3, 5, 2), bar(4, 20, 9), bar(5, 8, 7)];
    // pivot lows: idx1 (1 < 3 and 1 < 2) and idx3 (2 < 2? no) -> only idx1
    expect(impulseLow(bars)?.price).toBe(1);
    expect(impulseLow(bars)?.index).toBe(1);
  });

  it('takes the LAST such low when there are several', () => {
    const bars = [bar(0, 5, 3), bar(1, 4, 1), bar(2, 6, 2), bar(3, 7, 0), bar(4, 9, 4), bar(5, 20, 9), bar(6, 8, 7)];
    // pivot lows before the high at idx5: idx1 (1) and idx3 (0) -> the last one is idx3
    expect(impulseLow(bars)?.index).toBe(3);
  });

  it('is NULL when the leg began outside the window', () => {
    // The high is the second bar, so nothing before it can be a pivot. Guessing a start would
    // understate the impulse.
    const bars = [bar(0, 5, 3), bar(1, 20, 4), bar(2, 6, 2), bar(3, 5, 1)];
    expect(impulseLow(bars)).toBeNull();
  });

  it('is NULL for an empty window', () => {
    expect(impulseLow([])).toBeNull();
  });
});

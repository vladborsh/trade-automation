import { describe, expect, it } from 'vitest';
import { sparkGeometry } from './spark-bars';

/** IB-107 (§7.3) — the mini-chart geometry: positive series stand on the floor, signed ones hang from zero. */
describe('sparkGeometry', () => {
  it('all positive: bars stand on the bottom, the tallest fills the box, no zero line', () => {
    const g = sparkGeometry({ values: [1, 2, 4], highlight: 2 });
    expect(g.zero).toBeNull();
    expect(g.bars).toEqual([
      { top: 75, height: 25, lit: false },
      { top: 50, height: 50, lit: false },
      { top: 0, height: 100, lit: true },
    ]);
  });
  it('signed: the zero line sits by the range, a negative bar hangs below it', () => {
    const g = sparkGeometry({ values: [3, -1], highlight: null });
    expect(g.zero).toBe(75);
    expect(g.bars).toEqual([{ top: 0, height: 75, lit: false }, { top: 75, height: 25, lit: false }]);
  });
  it('all negative: zero at the top, bars hang from it', () => {
    const g = sparkGeometry({ values: [-2, -4], highlight: 1 });
    expect(g.zero).toBe(0);
    expect(g.bars.map((b) => [b.top, b.height, b.lit])).toEqual([[0, 50, false], [0, 100, true]]);
  });
  it('all zero: flat, no division by zero', () => {
    expect(sparkGeometry({ values: [0, 0], highlight: null }).bars.map((b) => b.height)).toEqual([0, 0]);
  });
  it('range scale (a level): the series spans its own range above a visible floor', () => {
    const g = sparkGeometry({ values: [296.0, 296.5, 298.0], highlight: 2 }, 'range');
    expect(g.zero).toBeNull();
    expect(g.bars.map((b) => Math.round(b.height))).toEqual([20, 40, 100]);
    expect(g.bars.map((b) => Math.round(b.top))).toEqual([80, 60, 0]);
    expect(sparkGeometry({ values: [5, 5], highlight: null }, 'range').bars.map((b) => b.height)).toEqual([100, 100]);
  });
  it('range scale never applies to a signed series: zero stays meaningful', () => {
    expect(sparkGeometry({ values: [3, -1], highlight: null }, 'range').zero).toBe(75);
  });
});

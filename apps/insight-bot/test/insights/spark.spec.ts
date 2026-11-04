import { bucketMeans, sparkOf, sparkWithNow } from '../../src/insights/spark';

/** IB-107 (D24) — the pure spark helpers: tails, highlight bookkeeping, no padded charts. */
describe('sparkOf', () => {
  it('keeps the last ≤ 30 and moves the highlight with them', () => {
    const xs = Array.from({ length: 42 }, (_, i) => i);
    expect(sparkOf(xs, 41)).toEqual({ values: xs.slice(12), highlight: 29 });
    expect(sparkOf(xs, 20)).toEqual({ values: xs.slice(12), highlight: 8 });
    expect(sparkOf(xs, 5)?.highlight).toBeNull(); // the lit bar fell out of the window
    expect(sparkOf(xs, 41, 24)).toEqual({ values: xs.slice(18), highlight: 23 });
  });
  it('fewer than two values, or a non-finite one, is no chart', () => {
    expect(sparkOf([7], 0)).toBeNull();
    expect(sparkOf([], null)).toBeNull();
    expect(sparkOf([1, Number.NaN, 3], 2)).toBeNull();
  });
  it('a highlight outside the values is dropped, not clamped', () => {
    expect(sparkOf([1, 2, 3], 3)).toEqual({ values: [1, 2, 3], highlight: null });
  });
});

describe('sparkWithNow', () => {
  it('the sample\'s tail, then now, lit', () => {
    expect(sparkWithNow([1, 2, 3, 4, 5], 99, 3)).toEqual({ values: [4, 5, 99], highlight: 2 });
    expect(sparkWithNow([], 99, 15)).toBeNull();
  });
});

describe('bucketMeans', () => {
  it('the hour ending at the last minute, in two-minute means; an empty bucket is skipped, never 0', () => {
    const pts = Array.from({ length: 60 }, (_, i) => ({ time: 6_000 + i * 60, value: i }));
    expect(bucketMeans(pts, 3_600, 120)).toEqual(Array.from({ length: 30 }, (_, k) => 2 * k + 0.5));
    const gappy = pts.filter((p) => p.value !== 10 && p.value !== 11);
    expect(bucketMeans(gappy, 3_600, 120)).toHaveLength(29);
    expect(bucketMeans([], 3_600, 120)).toEqual([]);
  });
});

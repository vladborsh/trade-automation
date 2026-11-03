import { rarity } from '../../src/insights/rarity';

describe('rarity (D2, mid-rank percentile)', () => {
  it('a typical value is ~0.5, a record is near 1, an empty sample has none', () => {
    expect(rarity(5, [1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeCloseTo(4.5 / 9);
    expect(rarity(100, [1, 2, 3])).toBe(1);
    expect(rarity(1, [])).toBeNull();
  });

  it('a quiet zero in a zero-heavy sample is NOT an outlier (mid-rank, not "≤")', () => {
    const sample = [...Array(90).fill(0), ...Array(10).fill(1_000)];
    expect(rarity(0, sample)).toBe(0.45); // "share ≤" would say 0.90 — exactly the show threshold
    expect(rarity(5_000, sample)).toBe(1);
  });
});

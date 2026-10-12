import { log1pZScore, meanAndSd, percentileOf } from '../../src/features/math/rolling';

/**
 * IB-015 §8.2 — the two rolling statistics. The cases that matter are the refusals: a percentile
 * with no history is not zero, and a z-score over a flat sample is not "exactly normal".
 */

describe('percentileOf', () => {
  it('is the fraction at or below the value', () => {
    // 4 of the 5 samples are <= 40
    expect(percentileOf([10, 20, 30, 40, 50], 40, 1)).toBeCloseTo(0.8, 10);
  });

  it('counts ties as at-or-below, so the maximum reads 1.0', () => {
    // §8.2's funding family tests `pct30d >= 0.90`; a venue at its own maximum must pass it.
    expect(percentileOf([1, 2, 3], 3, 1)).toBe(1);
    expect(percentileOf([1, 2, 2, 3], 2, 1)).toBeCloseTo(0.75, 10);
  });

  it('is 0 for a value below everything — a real measurement, not a refusal', () => {
    expect(percentileOf([10, 20, 30], 5, 1)).toBe(0);
  });

  it('REFUSES below minPeriods instead of answering from a short sample', () => {
    // §8.2: 90 settlements, min_periods 45. A percentile over 11 observations is a number, but
    // it is not the number the definition names, and nothing downstream could tell.
    expect(percentileOf([1, 2, 3], 2, 45)).toBeNull();
    expect(percentileOf([], 2, 1)).toBeNull();
  });
});

describe('meanAndSd', () => {
  it('uses the POPULATION sd, matching the convention already in bollinger.ts', () => {
    // values 2,4,4,4,5,5,7,9: mean 5, population sd 2 (sample sd would be ~2.138)
    const { mean, sd } = meanAndSd([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(mean).toBe(5);
    expect(sd).toBeCloseTo(2, 10);
  });
});

describe('log1pZScore', () => {
  it('transforms BEFORE taking the statistics', () => {
    // Raw sums are heavy-tailed and bounded below by zero; a z-score of the raw values is
    // dominated by cascades and reads "normal" for everything else.
    // sample [0, 0, 0, e-1]  -> log1p -> [0, 0, 0, 1]
    //   mean = 0.25; deviations -0.25, -0.25, -0.25, +0.75
    //   sq   = 3(0.0625) + 0.5625 = 0.75 ; population sd = sqrt(0.75 / 4) = 0.4330127
    // value e-1 -> log1p = 1       -> z = (1 - 0.25) / 0.4330127 = 1.7320508
    const z = log1pZScore([0, 0, 0, Math.E - 1], Math.E - 1, 1);
    expect(z).toBeCloseTo(1.7320508, 6);
  });

  it('REFUSES when the sample is shorter than the definition allows', () => {
    // §8.2: null until 14 days of liquidation history exist.
    expect(log1pZScore([1, 2, 3], 2, 336)).toBeNull();
  });

  it('REFUSES a flat sample rather than reporting 0, which would mean "exactly normal"', () => {
    // Every window held the same amount, so "how unusual is this" has no denominator. Same
    // mistake as IB-038's median-of-zero: a missing measurement is not an average one.
    expect(log1pZScore([5, 5, 5, 5], 5, 1)).toBeNull();
    expect(log1pZScore([0, 0, 0, 0], 100, 1)).toBeNull();
  });

  it('a genuinely average window scores 0, and that IS a measurement', () => {
    const sample = [0, Math.E - 1];
    const mid = Math.expm1(0.5); // log1p(mid) = 0.5, exactly the mean of [0, 1]
    expect(log1pZScore(sample, mid, 1)).toBeCloseTo(0, 10);
  });
});

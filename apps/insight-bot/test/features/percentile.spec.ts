import { mean, percentileRank, stdDev, zScore } from '../../src/features/calc/percentile';

/**
 * IB-015 — the shared percentile and z-score, on worked numbers.
 *
 * What these defend is not the arithmetic, it is the honesty of the output: below `minPeriods`
 * the answer is `null`, not a number, because a percentile of three samples is arithmetic
 * rather than information, and a playbook comparing it to 0.9 would act on noise.
 */

/** 1..100, oldest first. */
const HUNDRED = Array.from({ length: 100 }, (_, i) => i + 1);

describe('percentileRank — worked numbers', () => {
  it('ranks inclusively of ties: 50 in 1..100 is the 50th percentile', () => {
    expect(percentileRank(50, HUNDRED, { minPeriods: 10 })).toBe(0.5);
  });

  it('the maximum is 1 and the minimum is 0.01 in a 100-sample series', () => {
    expect(percentileRank(100, HUNDRED, { minPeriods: 10 })).toBe(1);
    expect(percentileRank(1, HUNDRED, { minPeriods: 10 })).toBe(0.01);
  });

  it('TIES COUNT: on a flat series every value is the 100th percentile, not the 0th', () => {
    // long runs of an identical funding rate are normal on a quiet venue; excluding ties would
    // put the rate at 0 purely because its neighbours equal it
    const flat = Array.from({ length: 50 }, () => 0.0001);
    expect(percentileRank(0.0001, flat, { minPeriods: 45 })).toBe(1);
  });

  it('a value below everything ranks 0', () => {
    expect(percentileRank(0, HUNDRED, { minPeriods: 10 })).toBe(0);
  });

  it('honours the window: only the last N samples are ranked', () => {
    // against the last 10 (91..100), 95 sits at 5/10
    expect(percentileRank(95, HUNDRED, { minPeriods: 5, window: 10 })).toBe(0.5);
  });

  it('is NULL below minPeriods — the whole point', () => {
    expect(percentileRank(2, [1, 2, 3], { minPeriods: 45 })).toBeNull();
    expect(percentileRank(2, [], { minPeriods: 1 })).toBeNull();
  });

  it('counts only finite samples toward minPeriods', () => {
    const withJunk = [1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3];
    expect(percentileRank(2, withJunk, { minPeriods: 4 })).toBeNull(); // 3 usable, not 5
    expect(percentileRank(2, withJunk, { minPeriods: 3 })).toBeCloseTo(2 / 3, 10);
  });

  it('a null or non-finite value has no rank', () => {
    expect(percentileRank(null, HUNDRED, { minPeriods: 10 })).toBeNull();
    expect(percentileRank(Number.NaN, HUNDRED, { minPeriods: 10 })).toBeNull();
  });
});

describe('mean and stdDev', () => {
  it('mean of 2,4,4,4,5,5,7,9 is 5', () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
  });

  it('SAMPLE stdDev (n−1) of that series is ~2.138, not the population 2', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.1380899, 6);
  });

  it('a flat series has NO standard deviation, and that is null rather than 0', () => {
    // returning 0 would let a z-score divide by it and produce Infinity dressed as a number
    expect(stdDev([5, 5, 5, 5])).toBeNull();
  });

  it('is null below two samples', () => {
    expect(stdDev([5])).toBeNull();
    expect(mean([])).toBeNull();
  });
});

describe('zScore — worked numbers', () => {
  it('a value one sample-sd above the mean scores 1', () => {
    const samples = [2, 4, 4, 4, 5, 5, 7, 9]; // mean 5, sd 2.1380899
    expect(zScore(5 + 2.1380899, samples)).toBeCloseTo(1, 6);
  });

  it('the mean itself scores 0', () => {
    expect(zScore(5, [2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(0, 10);
  });

  it('is negative below the mean', () => {
    expect(zScore(0, [2, 4, 4, 4, 5, 5, 7, 9])).toBeLessThan(0);
  });

  it('is NULL against a flat series rather than Infinity', () => {
    expect(zScore(10, [5, 5, 5, 5])).toBeNull();
  });

  it('is null when the value is missing', () => {
    expect(zScore(null, [1, 2, 3])).toBeNull();
  });
});

import { fundingCheck } from '../../../src/alerts/funding/funding-check';
import { levelBand } from '../../../src/insights/charts/chart-math';
import { fundingExtreme, fundingIntervalH, fundingSample, FUNDING_MIN_SETTLEMENTS } from '../../../src/insights/funding-extreme';
import { levelRarity } from '../../../src/insights/rarity';
import { FUNDING_FLOOR_PER_8H, RARITY_SHOW } from '../../../src/insights/thresholds';

/**
 * IB-124 (F2, F3, F8) — one check: both conditions, R5's judgement on the same sample, the 8 h normalisation, the
 * near-miss naming the one condition that failed.
 */
const H = 3_600;
/** `n` settlements every `everyH` hours ending at t=0, rates cycling through `rates`. */
function settled(n: number, everyH: number, rates: readonly number[]) {
  return Array.from({ length: n }, (_, i) => ({ time: (i - n) * everyH * H, rate: rates[i % rates.length] as number }));
}
/** A month at a spread of ordinary rates around +0.01 %/8 h: median 0.0001, p95-ish band about ±0.00009 around it. */
const MONTH_8H = settled(90, 8, [0.0001, 0.00005, 0.00015, 0.0001, 0.00008, 0.00012, 0.0001, 0.0000, 0.0002, 0.0001]);
const at = (rate: number, s = MONTH_8H, floorPer8h = FUNDING_FLOOR_PER_8H) =>
  fundingCheck({ rate, rateTimeMs: 0, nextFundingTimeMs: 0, settled: s, floorPer8h });

describe('IB-124 funding check (F2, F3, F8)', () => {
  it('F3: extreme only when BOTH hold — rare for the coin AND beyond the floor', () => {
    expect(at(0.0005)?.extreme).toBe('high'); // rare and ≥ 0.03 %
    expect(at(-0.0004)?.extreme).toBe('low');
    // beyond the floor but NOT rare: a coin that sits at 0.05 % all month
    const parked = settled(90, 8, [0.0005, 0.00045, 0.00055]);
    expect(at(0.0005, parked)?.extreme).toBeNull();
    // rare but inside the floor (BNB at 0.0206 %, owner 2026-11-05)
    expect(at(0.00025)?.extreme).toBeNull();
    expect(at(0.00025)?.facts.rarity).toBeGreaterThanOrEqual(RARITY_SHOW);
  });

  it('F3 / R5: the alert and R5 give the same verdict and the same band on the same sample (one helper, one floor)', () => {
    const rates = MONTH_8H.map((p) => p.rate);
    for (const r of [-0.0006, -0.0003, -0.0001, 0, 0.0001, 0.00025, 0.0003, 0.00031, 0.0005, 0.001]) {
      const c = at(r);
      const r5 = fundingExtreme(r, levelRarity(r, rates), fundingIntervalH(MONTH_8H.map((p) => p.time)));
      expect([r, c?.extreme ?? null]).toEqual([r, r5]);
      expect(c?.facts.band).toEqual(levelBand(rates, RARITY_SHOW));
      expect(c?.facts.rarity).toBe(levelRarity(r, rates));
    }
  });

  it('the recorded band is R5\'s at RARITY_SHOW on a sample without ties (not a neighbouring quantile)', () => {
    const distinct = Array.from({ length: 90 }, (_, i) => ({ time: (i - 90) * 8 * H, rate: 0.00001 * (i + 1) * (i % 2 ? 1 : -0.5) }));
    const rates = distinct.map((p) => p.rate);
    expect(at(0.0005, distinct)?.facts.band).toEqual(levelBand(rates, RARITY_SHOW));
    expect(levelBand(rates, RARITY_SHOW)).not.toEqual(levelBand(rates, 0.95));
  });

  it('F3: the floor defaults to FUNDING_FLOOR_PER_8H and a coin floor overrides it', () => {
    expect(at(0.0005)?.facts.floorPer8h).toBe(0.0003);
    expect(at(0.0005, MONTH_8H, 0.0006)?.extreme).toBeNull();
    expect(at(0.00025, MONTH_8H, 0.0002)?.extreme).toBe('high');
  });

  it('F2: a 4 h coin at 0.02 % is 0.04 %/8 h — extreme; the venue rate and interval are kept as they are', () => {
    const four = settled(180, 4, [0.00005, 0.00003, 0.00007, 0.00005, 0.00004, 0.00006, 0.00005, 0.0, 0.0001, 0.00005]);
    const c = at(0.0002, four);
    expect(c?.facts).toMatchObject({ rate: 0.0002, intervalH: 4, ratePer8h: 0.0004 });
    expect(c?.extreme).toBe('high');
    // the same 0.02 % on an 8 h coin of the same shape is inside the floor
    const eight = settled(90, 8, [0.00005, 0.00003, 0.00007, 0.00005, 0.00004, 0.00006, 0.00005, 0.0, 0.0001, 0.00005]);
    expect(at(0.0002, eight)?.extreme).toBeNull();
  });

  it('F2: a 1 h coin at 0.005 % is 0.04 %/8 h', () => {
    const one = settled(720, 1, [0.00001, 0.000005, 0.000015, 0.00001, 0.0, 0.00002]);
    const c = at(0.00005, one);
    expect(c?.facts).toMatchObject({ intervalH: 1, ratePer8h: 0.0004 });
    expect(c?.extreme).toBe('high');
  });

  it('too few settlements: no judgement (R5\'s own minimum, shared)', () => {
    expect(at(0.001, MONTH_8H.slice(-(FUNDING_MIN_SETTLEMENTS - 1)))).toBeNull();
    expect(at(0.001, MONTH_8H.slice(-FUNDING_MIN_SETTLEMENTS))).not.toBeNull();
    expect(fundingSample(MONTH_8H.slice(-(FUNDING_MIN_SETTLEMENTS - 1)))).toBeNull();
  });

  it('F8: a near-miss names the ONE condition that failed; both failing or both holding is not a near-miss', () => {
    expect(at(0.00025)?.nearMiss).toEqual({ side: 'high', failed: 'floor' });
    const parked = settled(90, 8, [0.0005, 0.00045, 0.00055]);
    expect(at(0.0005, parked)?.nearMiss).toEqual({ side: 'high', failed: 'band' });
    const parkedLow = settled(90, 8, [-0.0005, -0.00045, -0.00055]);
    expect(at(-0.0005, parkedLow)?.nearMiss).toEqual({ side: 'low', failed: 'band' });
    expect(at(0.0001)?.nearMiss).toBeNull();
    expect(at(0.0005)?.nearMiss).toBeNull();
  });
});

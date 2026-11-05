import type { WebPositioningCell, WebPositioningRow } from '@trade-automation/contracts';
import { fundingExtreme, fundingIntervalH, fundingPer8h } from '../../src/insights/funding-extreme';
import { R5 } from '../../src/insights/rules';
import { FUNDING_FLOOR_PER_8H, RARITY_SHOW } from '../../src/insights/thresholds';
import { isRefusal, type InsightSnapshot } from '../../src/insights/types';
import { signalOf } from '../../src/web/market/positioning/positioning.rules';

/**
 * IB-135 (market round 3 §1) — funding is said to be extreme only when it is rare for the coin AND at
 * least ±0.03 % per 8 h. The cases are the design's, the first one the owner's: "why did BNB get in?"
 */
describe('fundingExtreme', () => {
  it('the constant is the owner\'s 0.03 % per 8 h, as a fraction', () => expect(FUNDING_FLOOR_PER_8H).toBe(0.0003));

  it('BNB, 2026-11-05: rare for the coin (0.95) but 0.0206 % per 8 h → nothing to say', () => {
    expect(fundingExtreme(0.000206, 0.95, 8)).toBeNull();
  });
  it('0.031 % per 8 h, rare → high; −0.031 % → low', () => {
    expect(fundingExtreme(0.00031, 0.95, 8)).toBe('high');
    expect(fundingExtreme(-0.00031, 0.95, 8)).toBe('low');
  });
  it('a 4 h coin at 0.016 % pays 0.032 % per 8 h → high (the raw rate alone would say nothing)', () => {
    expect(fundingPer8h(0.00016, 4)).toBeCloseTo(0.00032, 12);
    expect(fundingExtreme(0.00016, 0.95, 4)).toBe('high');
    expect(fundingExtreme(-0.00016, 0.95, 4)).toBe('low');
  });
  it('an unknown interval counts as 8 h: the same 4 h coin is then silent (never a false statement)', () => {
    expect(fundingExtreme(0.00016, 0.95, null)).toBeNull();
  });
  it('the floor is inclusive, at 8 h and at 4 h', () => {
    expect(fundingExtreme(0.0003, 0.95, 8)).toBe('high');
    expect(fundingExtreme(0.00015, 0.95, 4)).toBe('high');
    expect(fundingExtreme(-0.0003, 0.95, 8)).toBe('low');
  });
  it('a big rate that is ordinary for the coin says nothing: rarity still gates', () => {
    expect(fundingExtreme(0.002, RARITY_SHOW - 0.01, 8)).toBeNull();
    expect(fundingExtreme(0.002, RARITY_SHOW, 8)).toBe('high');
    expect(fundingExtreme(0.002, null, 8)).toBeNull();
    expect(fundingExtreme(null, 0.99, 8)).toBeNull();
  });
});

describe('fundingIntervalH — the median of the last 3 settlement spacings, from the baseline\'s times', () => {
  const H = 3_600;
  const every = (h: number, n: number, from = 1_760_000_000) => Array.from({ length: n }, (_, i) => from + i * h * H);
  it('8 h and 4 h coins; a few ms of venue jitter (floored to seconds) still rounds to the hour', () => {
    expect(fundingIntervalH(every(8, 90))).toBe(8);
    expect(fundingIntervalH(every(4, 180))).toBe(4);
    expect(fundingIntervalH([0, 8 * H + 1, 16 * H - 1, 24 * H])).toBe(8);
  });
  it('one odd gap does not move it: a missed record, or the gap that spans a switch from 8 h to 4 h', () => {
    expect(fundingIntervalH([0, 8 * H, 24 * H, 32 * H])).toBe(8);
    expect(fundingIntervalH([0, 8 * H, 12 * H, 16 * H])).toBe(4);
  });
  it('reads only the LAST settlements: a coin that switched a week ago is its new interval', () => {
    expect(fundingIntervalH([...every(8, 60), ...every(4, 10, 1_760_000_000 + 60 * 8 * H)])).toBe(4);
  });
  it('null under 4 settlements, or for a spacing under an hour', () => {
    expect(fundingIntervalH([])).toBeNull();
    expect(fundingIntervalH(every(8, 3))).toBeNull();
    expect(fundingIntervalH([0, 60, 120, 180])).toBeNull();
  });
});

describe('R5 and signalOf read the SAME helper: the card and the table cannot disagree', () => {
  const c = (value: number | null, rarity: number | null, sample = 90): WebPositioningCell => ({ value, rarity, unavailable: rarity === null ? 'insufficient_history' : null, sample });
  const row = (rate: number, rarity: number): WebPositioningRow => ({
    symbol: 'XUSDT', base: 'X', priceChangePct: c(0.2, 0.3, 696), oiChangePct: c(0.3, 0.3, 696), fundingRate: c(rate, rarity),
    lsGlobal: c(rate > 0 ? 2.5 : 0.5, 0.97, 720), lsTopPosition: c(1, 0.5, 720), liqUsd: c(0, null), oiUsd: null, priceRefTime: null, quadrant: 'flat', signal: null,
  });
  const snap = (r: WebPositioningRow, intervalH: number | null): InsightSnapshot => ({
    period: '24h', nowMs: Date.UTC(2026, 10, 5, 12), liquidations: null, positioning: [r],
    fundingIntervalH: intervalH === null ? null : new Map([[r.symbol, intervalH]]), breadth: null, fng: null, flows: null, oiDivergence: null,
  });
  const cases: Array<[string, number, number, number | null]> = [
    ['BNB-like', 0.000206, 0.95, 8], ['0.031 %', 0.00031, 0.95, 8], ['−0.031 %', -0.00031, 0.95, 8],
    ['4 h 0.016 %', 0.00016, 0.95, 4], ['4 h, interval unknown', 0.00016, 0.95, null], ['ordinary for the coin', 0.002, 0.5, 8],
  ];
  it.each(cases)('%s', (_, rate, rarity, intervalH) => {
    const helper = fundingExtreme(rate, rarity, intervalH);
    const r = row(rate, rarity);
    const card = R5.run(snap(r, intervalH));
    const cardSays = card !== null && !isRefusal(card) && card.rarity >= RARITY_SHOW;
    const word = signalOf({ ...r, fundingIntervalH: intervalH, cells: [] });
    expect(cardSays).toBe(helper !== null);
    expect(word).toBe(helper === 'high' ? 'crowded_long' : helper === 'low' ? 'crowded_short' : null);
  });
});

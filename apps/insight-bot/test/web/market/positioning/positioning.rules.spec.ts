import { cell, changeRarity, levelRarity, quadrantOf, rollingChangesPct, signalOf } from '../../../../src/web/market/positioning/positioning.rules';
import { mapLimited, refClose } from '../../../../src/web/market/positioning/positioning.service';
import { rarity } from '../../../../src/insights/rarity';

/** IB-085 (D2, D3, D9) — the positioning rules. */
describe('rarity is rank-based and correct with zeros and repeats', () => {
  it('ties count half (mid-rank), so a run of equal values does not jump to an extreme', () => {
    expect(rarity(3, [3, 3, 3, 3])).toBe(0.5);
    expect(rarity(0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 10])).toBe(0.45);
    expect(rarity(10, [0, 0, 0, 0, 0, 0, 0, 0, 0, 10])).toBe(0.95);
  });

  it('a change is rare by its size either way: +5 % and −5 % rank the same', () => {
    const past = [-1, 0.5, -0.5, 1, 0.2, -0.2, 2, -2];
    expect(changeRarity(5, past)).toBe(changeRarity(-5, past));
    expect(changeRarity(5, past)).toBe(1);
  });

  it('a level is rare by its distance from the median: very low funding is as rare as very high', () => {
    const past = [0.0001, 0.0001, 0.0001, 0.0002, 0.0001, 0.0001];
    expect(levelRarity(0.001, past)).toBe(1);
    expect(levelRarity(-0.0008, past)).toBe(1);
    expect(levelRarity(0.0001, past)).toBeLessThan(0.5);
  });
});

describe('cell — a missing number is a stated reason, never 0', () => {
  it('no value: venue_unavailable unless told otherwise', () => {
    expect(cell(null, [1, 2], changeRarity)).toEqual({ value: null, rarity: null, unavailable: 'venue_unavailable', sample: 0 });
  });

  it('a value without enough history: the value, no rarity, insufficient_history', () => {
    expect(cell(2.5, null, changeRarity)).toEqual({ value: 2.5, rarity: null, unavailable: 'insufficient_history', sample: 0 });
  });

  it('a value with a sample: its rarity and the sample size', () => {
    expect(cell(3, [1, 2, 4, 5], changeRarity)).toEqual({ value: 3, rarity: 0.5, unavailable: null, sample: 4 });
  });
});

describe('rollingChangesPct', () => {
  it('percent changes over N steps back, skipping a zero base', () => {
    expect(rollingChangesPct([100, 110, 121, 0, 50], 1).map((x) => Math.round(x))).toEqual([10, 10, -100]);
    expect(rollingChangesPct([100, 105, 110], 2)).toEqual([10.000000000000009]);
  });
});

describe('quadrantOf — by the signs of the changes', () => {
  it('the four quadrants', () => {
    expect(quadrantOf(2, 5, 0.0001)).toBe('new_longs');
    expect(quadrantOf(-2, 5, 0.0001)).toBe('new_shorts');
    expect(quadrantOf(2, -5, 0.0001)).toBe('short_closing');
    expect(quadrantOf(-2, -5, 0.0001)).toBe('long_closing');
  });

  it('CONTROL: OI +26 % on a FLAT price is NOT flat — the side comes from the sign of funding', () => {
    expect(quadrantOf(0.1, 26, 0.0003)).toBe('new_longs');
    expect(quadrantOf(-0.1, 26, -0.0002)).toBe('new_shorts');
    expect(quadrantOf(0.1, 26, 0.0003)).not.toBe('flat');
  });

  it('OI within its flat band is flat whatever the price did; unknown inputs give no quadrant', () => {
    expect(quadrantOf(3, 0.5, 0.0001)).toBe('flat');
    expect(quadrantOf(null, 5, 0.0001)).toBeNull();
  });
});

describe('signalOf — the closed vocabulary', () => {
  const c = (value: number | null, r: number | null) => ({ value, rarity: r, unavailable: null, sample: 600 });
  const base = { priceChangePct: c(1, 0.5), fundingRate: c(0.0001, 0.5), lsGlobal: c(1.5, 0.5) };

  it('squeeze: shorts closing on a rare price rise; capitulation: longs closing on a rare fall', () => {
    expect(signalOf({ ...base, quadrant: 'short_closing', priceChangePct: c(6, 0.97), cells: [] })).toBe('squeeze');
    expect(signalOf({ ...base, quadrant: 'long_closing', priceChangePct: c(-6, 0.97), cells: [] })).toBe('capitulation');
  });

  it('crowded_long / crowded_short need rare funding AND a rare crowd on the same side', () => {
    expect(signalOf({ ...base, quadrant: 'new_longs', fundingRate: c(0.0005, 0.96), lsGlobal: c(3.2, 0.95), cells: [] })).toBe('crowded_long');
    expect(signalOf({ ...base, quadrant: 'new_shorts', fundingRate: c(-0.0004, 0.96), lsGlobal: c(0.6, 0.95), cells: [] })).toBe('crowded_short');
    // rare funding, crowd on the OTHER side: no crowded word
    expect(signalOf({ ...base, quadrant: 'flat', fundingRate: c(0.0005, 0.96), lsGlobal: c(0.6, 0.95), cells: [] })).toBeNull();
  });

  it('quiet: at least three measured cells, all under 0.5; fewer measured is not "quiet"', () => {
    expect(signalOf({ ...base, quadrant: 'flat', cells: [c(1, 0.2), c(1, 0.3), c(1, 0.1)] })).toBe('quiet');
    expect(signalOf({ ...base, quadrant: 'flat', cells: [c(1, 0.2), c(1, null), c(1, 0.1)] })).toBeNull();
  });
});

describe('helpers', () => {
  it('refClose: the last complete hour that ended at or before the instant', () => {
    const H = 3_600_000;
    const base = { closes: [1, 2, 3], closeTimes: [0, H, 2 * H] };
    expect(refClose(base, 2 * H)).toBe(2);
    expect(refClose(base, 2 * H - 1)).toBe(1);
    expect(refClose(base, 0)).toBeNull();
  });

  it('mapLimited keeps order and never has more than `limit` in flight', async () => {
    let inFlight = 0;
    let max = 0;
    const out = await mapLimited([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
      inFlight++; max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return x * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(max).toBe(3);
  });
});

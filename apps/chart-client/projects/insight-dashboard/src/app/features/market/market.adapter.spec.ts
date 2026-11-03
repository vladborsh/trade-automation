import { fearGreedZone } from '@trade-automation/contracts';
import { coinPrice, fearGreedBand, FEAR_GREED_BANDS } from './market.adapter';

describe('the Fear & Greed dial', () => {
  /**
   * IB-102: pinned at the row's ten edges to the zones the BOT uses (its fngBand reads the contract's
   * table). This spec used to assert 75 → extreme greed, i.e. it pinned the client's old off-by-one
   * copy (neutral ≤ 54, greed ≤ 74) instead of the server's 55 / 75.
   */
  it.each([
    [0, 'market.fg.extremeFear'], [24, 'market.fg.extremeFear'], [25, 'market.fg.fear'], [44, 'market.fg.fear'],
    [45, 'market.fg.neutral'], [55, 'market.fg.neutral'], [56, 'market.fg.greed'], [75, 'market.fg.greed'],
    [76, 'market.fg.extremeGreed'], [100, 'market.fg.extremeGreed'],
  ] as const)('%i → %s, the bot\'s zone too', (value, key) => {
    expect(fearGreedBand(value).key).toBe(key);
    expect(fearGreedBand(value).band).toBe(fearGreedZone(value));
  });

  it('agrees with the bot\'s zone for EVERY reading 0–100, not just at the edges', () => {
    const disagree = Array.from({ length: 101 }, (_, v) => v).filter((v) => fearGreedBand(v).band !== fearGreedZone(v));
    expect(disagree).toEqual([]);
  });

  it('clamps a value outside 0–100 instead of falling off the end of the table', () => {
    expect(fearGreedBand(-5).key).toBe(FEAR_GREED_BANDS[0].key);
    expect(fearGreedBand(300).key).toBe(FEAR_GREED_BANDS[FEAR_GREED_BANDS.length - 1].key);
  });

  it('gives every band a colour, because the card tints its headline with it', () => {
    for (const band of FEAR_GREED_BANDS) expect(band.colour).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('coinPrice (IB-037: the venue sends full float precision)', () => {
  it('rounds a four-figure coin to whole units — 83289.68745869919 is not a price anyone reads', () => {
    expect(coinPrice(83289.68745869919)).toBe('83,290');
  });

  it('keeps two decimals in the single-digit-to-hundreds range', () => {
    expect(coinPrice(769.8578155209467)).toBe('769.86');
    expect(coinPrice(1.420171426483137)).toBe('1.42');
  });

  it('keeps enough digits for a sub-cent coin to stay distinguishable', () => {
    expect(coinPrice(0.08828949927571071)).toBe('0.0883');
    expect(coinPrice(0.0000123456)).toBe('0.000012');
  });

  it('returns null for an absent or non-finite price rather than printing NaN', () => {
    expect(coinPrice(null)).toBeNull();
    expect(coinPrice(undefined)).toBeNull();
    expect(coinPrice(Number.NaN)).toBeNull();
  });

  it('handles zero without pretending it is unknown', () => {
    expect(coinPrice(0)).toBe('0.000000');
  });
});

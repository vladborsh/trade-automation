import { coinPrice, fearGreedBand, FEAR_GREED_BANDS } from './market.adapter';

describe('the Fear & Greed dial', () => {
  it('bands split at the venue’s own boundaries', () => {
    expect(fearGreedBand(0).key).toBe('market.fg.extremeFear');
    expect(fearGreedBand(24).key).toBe('market.fg.extremeFear');
    expect(fearGreedBand(25).key).toBe('market.fg.fear');
    expect(fearGreedBand(54).key).toBe('market.fg.neutral');
    expect(fearGreedBand(75).key).toBe('market.fg.extremeGreed');
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

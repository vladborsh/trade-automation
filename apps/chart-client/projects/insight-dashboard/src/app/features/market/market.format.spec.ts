import { asOfUtc, capUsd, fractionPercent, fractionSigned, percent, signed } from './market.format';

const MINUS = '−';

describe('asOfUtc', () => {
  it('states the instant in UTC to the minute', () => {
    expect(asOfUtc(Date.UTC(2026, 9, 12, 12, 4, 37))).toBe('2026-10-12 12:04');
  });

  it('is null for a missing instant rather than the epoch', () => {
    // a card that printed 1970-01-01 would be a confident wrong answer; null becomes «нет данных»
    expect(asOfUtc(null)).toBeNull();
    expect(asOfUtc(undefined)).toBeNull();
    expect(asOfUtc(Number.NaN)).toBeNull();
  });
});

describe('signed', () => {
  it('signs a change both ways, with the typographic minus', () => {
    expect(signed(2.1428)).toBe('+2.14');
    expect(signed(-0.3)).toBe(`${MINUS}0.30`);
  });

  it('prints a measured zero as a zero, and an unknown as null', () => {
    // these are different facts: "did not move" is a measurement, "we cannot compare" is not
    expect(signed(0)).toBe('+0.00');
    expect(signed(null)).toBeNull();
  });
});

describe('percent and the fraction pair', () => {
  it('leaves the % to the template and keeps two digits', () => {
    expect(percent(72.1)).toBe('72.10');
    expect(percent(null)).toBeNull();
  });

  it('turns the stored 0..1 shares and changes into percentages', () => {
    expect(fractionPercent(0.8349)).toBe('83.49');
    expect(fractionSigned(-0.031)).toBe(`${MINUS}3.10`);
    expect(fractionPercent(null)).toBeNull();
    expect(fractionSigned(null)).toBeNull();
  });
});

describe('capUsd', () => {
  it('quotes each cap at the scale it is read in', () => {
    expect(capUsd(2_412_000_000_000)).toBe('$2.41T');
    expect(capUsd(412_000_000_000)).toBe('$412B');
    expect(capUsd(8_300_000_000)).toBe('$8.3B');
    expect(capUsd(4_500_000)).toBe('$4.5M');
    expect(capUsd(850)).toBe('$850');
  });

  it('is null when there is no cap, which is not a cap of zero', () => {
    expect(capUsd(null)).toBeNull();
    expect(capUsd(undefined)).toBeNull();
  });
});

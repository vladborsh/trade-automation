import { ALL, BN, BY, HL, aggPoint } from './aggregate-test-points';
import { conventionBadge, coverageChip, coverageDiffText } from './coverage-text';

describe('coverageDiffText (aggregate-oi.md §1 point 2 — seam marker text)', () => {
  it('names a joining venue with +', () => {
    expect(coverageDiffText([BN, BY], [BN, BY, HL])).toBe('+Hyperliquid');
    expect(coverageDiffText([BY], [BN, BY])).toBe('+Binance');
  });

  it('names a leaving venue with a real minus sign (U+2212)', () => {
    expect(coverageDiffText([BN, BY, HL], [BN, BY])).toBe('−Hyperliquid');
  });

  it('names both sides of a swap, joins first', () => {
    expect(coverageDiffText([BN, BY], [BY, HL])).toBe('+Hyperliquid −Binance');
  });

  it('is empty when the coverage did not change', () => {
    expect(coverageDiffText([BN, BY], [BY, BN])).toBe('');
  });
});

describe('coverageChip (aggregate-oi.md §1 point 3)', () => {
  it('complete bar: count and every venue, in config order', () => {
    const chip = coverageChip(aggPoint(0, [HL, BY, BN]), ALL);
    expect(chip.text).toBe('3/3 · Binance · Bybit · Hyperliquid');
    expect(chip.complete).toBe(true);
  });

  it('partial bar: the missing venue is named, not implied', () => {
    const chip = coverageChip(aggPoint(0, [BN, BY]), ALL);
    expect(chip.text).toBe('2/3 · Binance · Bybit — без Hyperliquid');
    expect(chip.complete).toBe(false);
  });

  it('names every missing venue', () => {
    expect(coverageChip(aggPoint(0, [BY]), ALL).text).toBe('1/3 · Bybit — без Binance, Hyperliquid');
  });

  it('tooltip: per-venue USD and share of the total, missing venue said so', () => {
    const point = aggPoint(0, [BN, BY]);
    point.members = [
      { source: BN, value: 750, notional: 7.5e9 },
      { source: BY, value: 250, notional: 2.5e9 },
    ];
    point.notional = 1e10;
    const lines = coverageChip(point, ALL).tooltip.split('\n');
    expect(lines[0]).toBe('Binance: $7.500B · 75.0 %');
    expect(lines[1]).toBe('Bybit: $2.500B · 25.0 %');
    expect(lines[2]).toBe('Hyperliquid: нет в этой свече');
    expect(lines[3]).toBe('Итого: $10.00B');
  });

  it('tooltip falls back to base-unit shares when a leg has no USD', () => {
    const point = aggPoint(0, [BN, BY], { notional: false });
    point.members = [
      { source: BN, value: 300 },
      { source: BY, value: 100 },
    ];
    const tooltip = coverageChip(point, ALL).tooltip;
    expect(tooltip).toContain('Binance: нет USD · 75.0 %');
    expect(tooltip).toContain('Итого: нет USD-суммы (доли по количеству BTC)');
  });

  it('without a definition yet, the bar’s own coverage is the denominator', () => {
    expect(coverageChip(aggPoint(0, [BN, BY]), []).text).toBe('2/2 · Binance · Bybit');
  });
});

describe('conventionBadge (aggregate-oi.md §2)', () => {
  it("one-sided: says why, and that CoinGlass/Coinalyze-style sums read ~16 % higher", () => {
    const badge = conventionBadge('one-sided');
    expect(badge.text).toBe('one-sided');
    expect(badge.tooltip).toContain('16 %');
    expect(badge.tooltip).toContain('Coinalyze численно не проверяли');
  });

  it("as-published reads 'as published'", () => {
    expect(conventionBadge('as-published').text).toBe('as published');
  });
});

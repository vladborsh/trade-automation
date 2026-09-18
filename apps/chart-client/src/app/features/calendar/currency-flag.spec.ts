import { currencyFlag, currencyWithFlag, regionFlag } from './currency-flag';

describe('currencyFlag (§11.4)', () => {
  it.each([
    ['USD', '🇺🇸'],
    ['EUR', '🇪🇺'],
    ['GBP', '🇬🇧'],
    ['JPY', '🇯🇵'],
    ['CAD', '🇨🇦'],
    ['AUD', '🇦🇺'],
    ['NZD', '🇳🇿'],
    ['CHF', '🇨🇭'],
    ['CNY', '🇨🇳'],
  ])('%s → %s, code kept as the label', (code, emoji) => {
    expect(currencyFlag(code)).toEqual({ emoji, label: code });
  });

  it("'All' → globe", () => {
    expect(currencyFlag('All')).toEqual({ emoji: '🌐', label: 'All' });
  });

  it('an unknown code → no emoji, the code alone', () => {
    expect(currencyFlag('XAU')).toEqual({ emoji: null, label: 'XAU' });
    expect(currencyWithFlag('XAU')).toBe('XAU');
  });

  it('builds regional-indicator pairs at runtime', () => {
    expect(regionFlag('US')).toBe('\u{1F1FA}\u{1F1F8}');
  });

  it('currencyWithFlag always keeps the code', () => {
    expect(currencyWithFlag('USD')).toBe('🇺🇸 USD');
    expect(currencyWithFlag('All')).toBe('🌐 All');
  });
});

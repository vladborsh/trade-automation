import { currencyOptions } from './currency-options';

describe('currencyOptions (§11.3)', () => {
  it('always offers the fixed list, even when the week has none of it', () => {
    expect(currencyOptions([], [])).toEqual(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY']);
  });

  it('appends other seen or selected codes alphabetically, never All, never duplicates', () => {
    const options = currencyOptions(['USD', 'All', 'SEK', 'BRL'], ['XAU', 'USD']);
    expect(options.slice(9)).toEqual(['BRL', 'SEK', 'XAU']);
    expect(options).not.toContain('All');
  });
});

import { clampRsiPeriod, commitRsiPeriod, defaultRsiPrefs, isRsiVisible, parseRsiPrefs, withRsiVisible } from './rsi-prefs';

describe('parseRsiPrefs', () => {
  it('defaults to period 14, everything visible, for missing / bad JSON / wrong shapes', () => {
    for (const raw of [null, '', '{not json', '[]', '42', 'null', '"x"']) {
      expect(parseRsiPrefs(raw)).toEqual({ period: 14, hidden: {} });
    }
  });

  it('keeps a valid stored value', () => {
    expect(parseRsiPrefs('{"period":21,"hidden":{"crypto":["btc","eth"]}}')).toEqual({
      period: 21,
      hidden: { crypto: ['btc', 'eth'] },
    });
  });

  it('clamps the stored period to 2–100 and defaults a non-numeric one', () => {
    expect(parseRsiPrefs('{"period":1}').period).toBe(2);
    expect(parseRsiPrefs('{"period":5000}').period).toBe(100);
    expect(parseRsiPrefs('{"period":"abc"}').period).toBe(14);
    expect(parseRsiPrefs('{"period":null}').period).toBe(14);
  });

  it('drops malformed hidden entries and non-string / duplicate ids', () => {
    expect(parseRsiPrefs('{"hidden":{"a":"btc","b":["btc",3,"btc","eth"]}}').hidden).toEqual({ b: ['btc', 'eth'] });
    expect(parseRsiPrefs('{"hidden":["btc"]}').hidden).toEqual({});
  });
});

describe('clampRsiPeriod / commitRsiPeriod', () => {
  it('rounds and clamps', () => {
    expect(clampRsiPeriod(0)).toBe(2);
    expect(clampRsiPeriod(101)).toBe(100);
    expect(clampRsiPeriod(14.6)).toBe(15);
    expect(clampRsiPeriod('9')).toBe(9);
    expect(clampRsiPeriod(Number.NaN)).toBe(14);
  });

  it('keeps the current period for a blank / non-numeric input', () => {
    expect(commitRsiPeriod(21, '')).toBe(21);
    expect(commitRsiPeriod(21, 'abc')).toBe(21);
    expect(commitRsiPeriod(21, null)).toBe(21);
    expect(commitRsiPeriod(21, '7')).toBe(7);
    expect(commitRsiPeriod(21, '500')).toBe(100);
  });
});

describe('isRsiVisible / withRsiVisible', () => {
  it('is visible by default and toggles per layout + panel', () => {
    const prefs = defaultRsiPrefs();
    expect(isRsiVisible(prefs, 'crypto', 'btc')).toBe(true);
    const hidden = withRsiVisible(prefs, 'crypto', 'btc', false);
    expect(isRsiVisible(hidden, 'crypto', 'btc')).toBe(false);
    expect(isRsiVisible(hidden, 'crypto', 'eth')).toBe(true);
    expect(isRsiVisible(hidden, 'us-indices', 'btc')).toBe(true);
    expect(prefs.hidden).toEqual({}); // input untouched
    expect(withRsiVisible(hidden, 'crypto', 'btc', false).hidden).toEqual({ crypto: ['btc'] }); // no duplicate
    expect(isRsiVisible(withRsiVisible(hidden, 'crypto', 'btc', true), 'crypto', 'btc')).toBe(true);
  });
});

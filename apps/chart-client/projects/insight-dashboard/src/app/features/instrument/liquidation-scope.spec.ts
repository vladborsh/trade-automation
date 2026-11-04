import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';
import type { StringKey } from '../../i18n/keys';
import { LIQUIDATION_COLORS, liquidationScopeLabel } from './liquidation-scope';

const make = (table: Record<string, string>) =>
  (key: StringKey, params?: Record<string, string | number>): string =>
    (table[key] ?? `MISSING:${key}`).replace(/\{(\w+)\}/g, (whole, name: string) =>
      params && name in params ? String(params[name]) : whole);

const tRu = make(ru as Record<string, string>);
const tEn = make(en as Record<string, string>);

describe('LIQUIDATION_COLORS', () => {
  it('colours a liquidated long with the DOWN colour', () => {
    // The colour follows what the market did, not the noun. Carried from IB-031 through every
    // liquidation surface: the panel, the overview card, and now the chart markers.
    expect(LIQUIDATION_COLORS.long).toBe('#ef5350');
    expect(LIQUIDATION_COLORS.short).toBe('#26a69a');
  });
});

describe('liquidationScopeLabel', () => {
  it('NAMES THE VENUES THE DATA CAME FROM', () => {
    // IB-BUG-011: the old label took the filter, so a query that reached one venue still read
    // «все биржи». This one can only say what actually contributed.
    expect(liquidationScopeLabel(tRu, ['okx', 'bybit'], false)).toContain('Bybit, OKX');
  });

  it('says «нет данных» when nothing contributed, instead of a venue list', () => {
    // A filter always has a value even when the result is empty; this distinguishes them.
    const label = liquidationScopeLabel(tRu, [], false);
    expect(label).not.toContain('Bybit');
    expect(label).toBe(ru['instrument.liq.noVenues']);
  });

  it('states the Binance undercount in the label, not in a footnote nobody opens', () => {
    const plain = liquidationScopeLabel(tRu, ['bybit'], false);
    const capped = liquidationScopeLabel(tRu, ['bybit'], true);
    expect(capped).not.toBe(plain);
    expect(capped.length).toBeGreaterThan(plain.length);
  });

  it('says the same thing in English — the warning is not a Russian-only courtesy', () => {
    const capped = liquidationScopeLabel(tEn, ['bybit'], true);
    expect(capped).not.toContain('MISSING:');
    expect(capped).toContain('Bybit');
  });

  // IB-BUG-033: identifiers are not translated (§11) but are SPELLED as their owners spell them, the
  // same map as the Market page's basis lines and credits (WEB_VENUE_NAMES) — never our lowercase keys
  it('keeps venue names untranslated and the same in both languages, spelled as names, not keys', () => {
    for (const t of [tRu, tEn]) {
      const label = liquidationScopeLabel(t, ['binance', 'bybit', 'okx'], false);
      expect(label).toContain('Binance, Bybit, OKX');
      expect(label).not.toMatch(/\b(binance|bybit|okx)\b/);
    }
  });

  it('CARRIES THE 24h TOTAL ABOVE THE FOLD, and says the detail is below', () => {
    // The summary card is below the fold by design (the row keeps its full height). This line is
    // not, so it has to tell a reader the number exists and roughly how big it is.
    const withTotal = liquidationScopeLabel(tRu, ['bybit'], false, '$10M');
    expect(withTotal).toContain('$10M');
    expect(withTotal).toContain('Bybit');
    expect(withTotal.length).toBeGreaterThan(liquidationScopeLabel(tRu, ['bybit'], false).length);
  });

  it('omits the total clause entirely when there is no summary to point at', () => {
    // A coin outside the top 20 has no overview row; the line must not read «за 24 ч null».
    const bare = liquidationScopeLabel(tRu, ['bybit'], false, null);
    expect(bare).not.toContain('null');
    expect(bare).toBe(liquidationScopeLabel(tRu, ['bybit'], false));
  });

  it('still says «нет данных» with a total, rather than a venue-less number', () => {
    expect(liquidationScopeLabel(tRu, [], false, '$10M')).toBe(ru['instrument.liq.noVenues']);
  });

  it('sorts the venues so the label is stable between refreshes', () => {
    expect(liquidationScopeLabel(tRu, ['okx', 'bybit'], false))
      .toBe(liquidationScopeLabel(tRu, ['bybit', 'okx'], false));
  });
});

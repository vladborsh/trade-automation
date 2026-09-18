/**
 * architecture/economic-calendar.md §11.4 — currency code → flag emoji. The
 * flag is built from an ISO 3166 region as a regional-indicator pair at
 * runtime (never hand-typed glyphs) and is decoration only: callers always
 * show the currency code beside it. Platforms without flag fonts render the
 * pair as two letters, which is still correct next to the code.
 */
const CURRENCY_REGION: Readonly<Record<string, string>> = {
  USD: 'US',
  EUR: 'EU', // the EU's own pair — the honest symbol for a currency of 20 states
  GBP: 'GB',
  JPY: 'JP',
  CAD: 'CA',
  AUD: 'AU',
  NZD: 'NZ',
  CHF: 'CH',
  CNY: 'CN',
};

const GLOBE = '\u{1F310}';
const REGIONAL_INDICATOR_A = 0x1f1e6;

export interface CurrencyFlag {
  emoji: string | null;
  label: string;
}

export function regionFlag(region: string): string {
  return [...region.toUpperCase()].map((ch) => String.fromCodePoint(REGIONAL_INDICATOR_A + ch.charCodeAt(0) - 65)).join('');
}

export function currencyFlag(code: string): CurrencyFlag {
  if (code === 'All') {
    return { emoji: GLOBE, label: code };
  }
  const region = CURRENCY_REGION[code];
  return { emoji: region ? regionFlag(region) : null, label: code };
}

/** `🇺🇸 USD` — or just `XYZ` when there is no flag. */
export function currencyWithFlag(code: string): string {
  const { emoji, label } = currencyFlag(code);
  return emoji ? `${emoji} ${label}` : label;
}

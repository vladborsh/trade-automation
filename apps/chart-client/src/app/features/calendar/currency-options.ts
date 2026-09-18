import { FIXED_CURRENCIES } from '../../core/state/calendar-settings.defaults';

/**
 * §11.3 — the currencies offered in the filter bar: the fixed list first (so
 * a default like GBP never vanishes in a week without GBP events), then any
 * other code seen this week or already selected, alphabetically. `All` is not
 * offered: it passes whenever any currency is selected.
 */
export function currencyOptions(seen: readonly string[], selected: readonly string[]): string[] {
  const fixed = new Set(FIXED_CURRENCIES);
  const extra = [...new Set([...seen, ...selected])].filter((c) => c !== 'All' && !fixed.has(c)).sort();
  return [...FIXED_CURRENCIES, ...extra];
}

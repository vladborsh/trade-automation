import type { BacktestInstrument } from '@trade-automation/contracts';

export interface InstrumentGroup {
  currency: string;
  instruments: BacktestInstrument[];
}

/**
 * The create form's picker (decisions 16, 36, D11): only instruments with stored 1m, grouped by
 * `sessionCurrency` (never by quote currency; there is no fallback), groups and members sorted.
 */
export function groupByCurrency(instruments: readonly BacktestInstrument[]): InstrumentGroup[] {
  const groups = new Map<string, BacktestInstrument[]>();
  for (const i of instruments) {
    if (!i.coverage) continue;
    groups.set(i.sessionCurrency, [...(groups.get(i.sessionCurrency) ?? []), i]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, list]) => ({ currency, instruments: [...list].sort((a, b) => a.displayName.localeCompare(b.displayName)) }));
}

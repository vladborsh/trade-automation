import type { WebUniverseSummaryRow, WebUniverseSymbol } from '@trade-automation/contracts';
import { fractionSigned, signed } from '../market/market.format';

/**
 * The symbol dropdown's rows: the top list, filtered by what the reader typed, with each coin's
 * live figures beside it when the summary has arrived.
 *
 * The list comes from `/universe/top` and the figures from `/universe/summary`; they are separate
 * requests so the dropdown is usable the moment the list arrives and the figures fill in after.
 * A figure the venue did not give is `null`, which the template shows as a dash: a missing
 * number is never printed as `0.00`.
 */
export type Sign = -1 | 0 | 1;

export interface PickerRow {
  id: string;
  base: string;
  active: boolean;
  /** `+1.84`, percent; the template adds the unit. */
  change: string | null;
  changeSign: Sign | null;
  /** Predicted funding as a signed percentage, four places: `+0.0123`. */
  funding: string | null;
  fundingSign: Sign | null;
  /** Open-interest change over 24 h, percent, one place. */
  oi: string | null;
  oiSign: Sign | null;
}

const sign = (v: number | null): Sign | null => (v === null ? null : v > 0 ? 1 : v < 0 ? -1 : 0);

/** True when `query` names this coin: by its id anywhere, or by the start of its base. */
export function matches(symbol: Pick<WebUniverseSymbol, 'id' | 'base'>, query: string): boolean {
  const q = query.trim().toUpperCase();
  if (q === '') return true;
  return symbol.id.toUpperCase().includes(q) || symbol.base.toUpperCase().startsWith(q);
}

export function pickerRows(
  universe: readonly WebUniverseSymbol[],
  summary: readonly WebUniverseSummaryRow[] | null,
  query: string,
  activeId: string,
): PickerRow[] {
  const figures = new Map((summary ?? []).map((r) => [r.id, r]));
  return universe.filter((s) => matches(s, query)).map((s) => {
    const f = figures.get(s.id);
    const change = f?.changePct24h ?? null;
    const funding = f?.fundingRate ?? null;
    const oi = f?.oiChangePct24h ?? null;
    return {
      id: s.id,
      base: s.base,
      active: s.id === activeId,
      change: signed(change, 2),
      changeSign: sign(change),
      funding: fractionSigned(funding, 4),
      fundingSign: sign(funding),
      oi: signed(oi, 1),
      oiSign: sign(oi),
    };
  });
}

/** What Enter opens: the only match if there is exactly one, else the typed text as a symbol. */
export function enterTarget(rows: readonly PickerRow[], query: string): string | null {
  if (rows.length === 1) return rows[0].id;
  const typed = query.trim().toUpperCase();
  return typed === '' ? null : typed;
}

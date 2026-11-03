import type { WebPositioningRow } from '@trade-automation/contracts';
import { HEAT_COLUMNS, heatRow, type HeatColumn } from './pos-layout';

/**
 * IB-103 — how the positioning table sorts, and how that sort lives in the URL.
 *
 * A key is one of:
 * - `rarity`           — the row's highest rarity across its cells (the default: most unusual first);
 * - `<column>`         — that column's VALUE (price change, OI change, funding, L/S, liquidations);
 * - `<column>.rarity`  — that column's RARITY against the coin's own 30 days;
 * - `oi`               — open interest in USD (Binance), the quadrant's dot size;
 * - `base`             — the ticker.
 *
 * A missing value is ALWAYS last, in both directions: an absence is not the smallest number. Rows
 * equal on the key are ordered by ticker, so the order never depends on how the server listed them.
 */
export type SortKey = 'rarity' | 'oi' | 'base' | HeatColumn | `${HeatColumn}.rarity`;
export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: SortState = { key: 'rarity', dir: 'desc' };

const KEYS: ReadonlySet<string> = new Set<string>([
  'rarity', 'oi', 'base', ...HEAT_COLUMNS, ...HEAT_COLUMNS.map((c) => `${c}.rarity`),
]);

function keyOf(row: WebPositioningRow, key: SortKey): number | string | null {
  if (key === 'base') return row.base;
  if (key === 'oi') return row.oiUsd;
  if (key === 'rarity') {
    const max = heatRow(row).maxRarity;
    return max < 0 ? null : max;
  }
  if (key.endsWith('.rarity')) return row[key.slice(0, -'.rarity'.length) as HeatColumn].rarity;
  return row[key as HeatColumn].value;
}

export function sortRows(rows: readonly WebPositioningRow[], key: SortKey, dir: SortDir): WebPositioningRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row) => ({ row, k: keyOf(row, key) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) {
        if (a.k === b.k) return a.row.base.localeCompare(b.row.base);
        return a.k === null ? 1 : -1;
      }
      const c = typeof a.k === 'string' ? a.k.localeCompare(b.k as string) : a.k - (b.k as number);
      return c !== 0 ? sign * c : a.row.base.localeCompare(b.row.base);
    })
    .map((x) => x.row);
}

/** `?sort=&dir=` → a sort; anything unknown falls back to the default rather than throwing. */
export function parseSort(sort: string | null | undefined, dir: string | null | undefined): SortState {
  if (!sort || !KEYS.has(sort)) return DEFAULT_SORT;
  return { key: sort as SortKey, dir: dir === 'asc' || dir === 'desc' ? dir : firstDir(sort as SortKey) };
}

/** The query params for a sort; the default is no params, so the plain link stays plain. */
export function sortQuery(state: SortState): { sort: string | null; dir: string | null } {
  return state.key === DEFAULT_SORT.key && state.dir === DEFAULT_SORT.dir ? { sort: null, dir: null } : { sort: state.key, dir: state.dir };
}

/** A header tapped: the same key flips direction; a new key starts biggest-first (A→Z for the ticker). */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
  return { key, dir: firstDir(key) };
}

function firstDir(key: SortKey): SortDir {
  return key === 'base' ? 'asc' : 'desc';
}

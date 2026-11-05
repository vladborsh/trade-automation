import type { WebPositioningRow } from '@trade-automation/contracts';

/**
 * IB-136 — «Найти монету» on /positioning: which rows of the table a query keeps.
 *
 * A query matches a row when it is a substring of the row's ticker (`base`), ignoring case and the
 * spaces around it. An empty (or all-space) query is no filter. Only the TABLE is filtered: the
 * quadrant is a picture of the whole market and keeps every coin.
 */
export function normalizeQuery(q: string | null | undefined): string {
  return (q ?? '').trim();
}

export function filterByTicker(rows: readonly WebPositioningRow[], q: string | null | undefined): readonly WebPositioningRow[] {
  const needle = normalizeQuery(q).toUpperCase();
  if (needle === '') return rows;
  return rows.filter((r) => r.base.toUpperCase().includes(needle));
}

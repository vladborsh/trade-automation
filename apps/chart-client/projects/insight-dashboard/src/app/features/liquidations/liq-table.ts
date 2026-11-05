import { venueName, type WebLiquidationLargeRow } from '@trade-automation/contracts';
import { instrumentLink, tickLabel, type InstrumentLink } from './liq-layout';
import { formatUsd } from './liquidations.format';

/**
 * IB-120 (market-round2 design §4) — the /liquidations table: what each cell says and how a column
 * sorts. Sorting is on the client, over the ≤ 1 000 rows the server returned.
 */
export const LIQ_COLUMNS = ['time', 'base', 'side', 'usd', 'price', 'venue', 'series'] as const;
export type LiqColumn = (typeof LIQ_COLUMNS)[number];
export type LiqSortDir = 'asc' | 'desc';
export interface LiqSort {
  column: LiqColumn;
  dir: LiqSortDir;
}

/** The server's order: newest first. */
export const LIQ_DEFAULT_SORT: LiqSort = { column: 'time', dir: 'desc' };

/** Hidden at ≤ 480 px (§4: «на 390 px цена и биржа скрыты»). */
export const LIQ_PHONE_HIDDEN: readonly LiqColumn[] = ['price', 'venue'];

export function parseLiqSort(column: string | null, dir: string | null): LiqSort {
  if (column === null || !(LIQ_COLUMNS as readonly string[]).includes(column)) return LIQ_DEFAULT_SORT;
  return { column: column as LiqColumn, dir: dir === 'asc' ? 'asc' : 'desc' };
}

/** A header tap: the same column flips; another column starts at its natural direction. */
export function nextLiqSort(current: LiqSort, column: LiqColumn): LiqSort {
  if (current.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  // words read A→Z first; numbers and time read biggest/newest first
  return { column, dir: column === 'base' || column === 'side' || column === 'venue' ? 'asc' : 'desc' };
}

/** «137 за 8 мин» — the Market card's rule: a series of at least 3, minutes rounded, at least 1. */
export function seriesOf(row: WebLiquidationLargeRow): { count: number; minutes: number } | null {
  if (row.seriesId === null || row.seriesCount < 3) return null;
  return { count: row.seriesCount, minutes: Math.max(1, Math.round(row.seriesSpanSec / 60)) };
}

function sortValue(row: WebLiquidationLargeRow, column: LiqColumn): number | string {
  switch (column) {
    case 'time': return row.time;
    case 'base': return row.base;
    case 'side': return row.side;
    case 'usd': return row.usd;
    case 'price': return row.price;
    case 'venue': return venueName(row.venue);
    case 'series': return seriesOf(row)?.count ?? 0;
  }
}

/** Sorted copy; ties fall back to newest first, so equal cells keep a stable, meaningful order. */
export function sortLiqRows(rows: readonly WebLiquidationLargeRow[], sort: LiqSort): WebLiquidationLargeRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.column);
    const y = sortValue(b, sort.column);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return c !== 0 ? sign * c : b.time - a.time;
  });
}

/** `69 412`, `2 391`, `182.35`, `0.1712`: whole above 1 000, cents above 1, four significant below. */
export function formatPrice(price: number): string {
  const abs = Math.abs(price);
  const text = abs >= 1_000
    ? Math.round(price).toLocaleString('en-US')
    : abs >= 1 ? price.toFixed(2) : price.toPrecision(4);
  return text.replace(/,/g, ' ');
}

export interface LiqRowView {
  row: WebLiquidationLargeRow;
  time: string;
  usd: string;
  price: string;
  venue: string;
  series: { count: number; minutes: number } | null;
  link: InstrumentLink;
}

/** One row as the table prints it. 7d shows the day too: «03.11 17:04». */
export function liqRowView(row: WebLiquidationLargeRow, withDay: boolean, timeZone?: string): LiqRowView {
  return {
    row,
    time: tickLabel(row.time, withDay ? 86_400 : 60, timeZone),
    usd: formatUsd(row.usd),
    price: formatPrice(row.price),
    venue: venueName(row.venue),
    series: seriesOf(row),
    link: instrumentLink(row),
  };
}

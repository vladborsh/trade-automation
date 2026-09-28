import type { WebGapReportCell, WebGapReportsResponse } from '@trade-automation/contracts';

/**
 * Pure: the flat `(day, symbol, series, missing, expected)` rows of `GET /health/gap-reports`
 * become the symbol × day grid the page renders (design §2's "last 14 daily gap reports as a
 * grid"). Kept beside the component and specced on its own, per AGENTS.md.
 */

export interface GapGridCell {
  day: string;
  missing: number;
  expected: number;
  /** null when no report covered that (symbol, day) — an absent report is not a clean day. */
  known: boolean;
}

export interface GapGridRow {
  symbol: string;
  cells: GapGridCell[];
  /** Total missing across the window, for sorting the worst offenders to the top. */
  totalMissing: number;
}

export interface GapGrid {
  days: string[];
  rows: GapGridRow[];
}

/**
 * `series` is summed per (symbol, day): the grid answers "did this symbol lose anything that day",
 * and a reader who needs the per-series split opens the day's report. Summing is why `expected`
 * is summed too — a ratio built from a summed numerator and a per-series denominator would be
 * quietly wrong.
 */
export function toGapGrid(response: WebGapReportsResponse): GapGrid {
  const days = [...response.days].sort();
  const bySymbol = new Map<string, Map<string, { missing: number; expected: number }>>();

  for (const cell of response.cells) {
    const row = bySymbol.get(cell.symbol) ?? new Map<string, { missing: number; expected: number }>();
    const acc = row.get(cell.day) ?? { missing: 0, expected: 0 };
    acc.missing += cell.missing;
    acc.expected += cell.expected;
    row.set(cell.day, acc);
    bySymbol.set(cell.symbol, row);
  }

  const rows: GapGridRow[] = [...bySymbol.entries()].map(([symbol, byDay]) => {
    const cells = days.map((day) => {
      const acc = byDay.get(day);
      return { day, missing: acc?.missing ?? 0, expected: acc?.expected ?? 0, known: acc !== undefined };
    });
    return { symbol, cells, totalMissing: cells.reduce((sum, c) => sum + c.missing, 0) };
  });

  // worst first, then alphabetical — a clean grid reads as a wall of dashes, which is the point
  rows.sort((a, b) => b.totalMissing - a.totalMissing || a.symbol.localeCompare(b.symbol));
  return { days, rows };
}

/** What a cell shows: a dash for a clean day, '?' for a day no report covered, else the count. */
export function cellLabel(cell: GapGridCell): string {
  if (!cell.known) return '?';
  return cell.missing === 0 ? '·' : String(cell.missing);
}

/** The cell's severity class, so the grid is readable without reading every number. */
export function cellSeverity(cell: GapGridCell): 'unknown' | 'clean' | 'minor' | 'bad' {
  if (!cell.known) return 'unknown';
  if (cell.missing === 0) return 'clean';
  // 1 % of an expected day is the line between "a reconnect" and "something was down"
  return cell.expected > 0 && cell.missing / cell.expected > 0.01 ? 'bad' : 'minor';
}

/** Only the cells that actually lost data, newest first — the page's summary line. */
export function worstCells(grid: GapGrid, limit = 5): Array<GapGridCell & { symbol: string }> {
  return grid.rows
    .flatMap((row) => row.cells.filter((c) => c.known && c.missing > 0).map((c) => ({ ...c, symbol: row.symbol })))
    .sort((a, b) => b.missing - a.missing)
    .slice(0, limit);
}

export type { WebGapReportCell };

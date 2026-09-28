import type { WebCoverageRow } from '@trade-automation/contracts';

/**
 * Pure helpers for the coverage page (AGENTS.md: anything that can be a pure function lives beside
 * the component with its own spec). Design §2: per symbol × series, first row, last row, missing
 * months.
 */

export interface CoverageView extends WebCoverageRow {
  /** '—' when the series holds nothing, else the ISO day of the first/last row. */
  firstLabel: string;
  lastLabel: string;
  /** A series with no rows at all is a different problem from one with a hole in the middle. */
  state: 'empty' | 'holes' | 'complete';
}

function day(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toISOString().slice(0, 10);
}

export function toCoverageViews(rows: readonly WebCoverageRow[]): CoverageView[] {
  return rows
    .map((row) => ({
      ...row,
      firstLabel: day(row.firstRow),
      lastLabel: day(row.lastRow),
      state: row.firstRow === null ? ('empty' as const) : row.missingMonths.length > 0 ? ('holes' as const) : ('complete' as const),
    }))
    // the rows worth acting on first: nothing at all, then holes, then the complete ones
    .sort((a, b) => rank(a.state) - rank(b.state) || a.symbol.localeCompare(b.symbol) || a.series.localeCompare(b.series));
}

function rank(state: CoverageView['state']): number {
  return state === 'empty' ? 0 : state === 'holes' ? 1 : 2;
}

/** The one-line summary above the table. */
export function coverageSummary(views: readonly CoverageView[]): string {
  const empty = views.filter((v) => v.state === 'empty').length;
  const holes = views.filter((v) => v.state === 'holes').length;
  if (views.length === 0) return 'no series reported';
  if (empty === 0 && holes === 0) return `${views.length} series, all complete`;
  return `${views.length} series: ${empty} empty, ${holes} with missing months`;
}

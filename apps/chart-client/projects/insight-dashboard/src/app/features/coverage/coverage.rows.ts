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

/**
 * The counts behind the summary line. Pure numbers rather than a sentence: §11 puts every sentence
 * in the string table, and a helper that returned prose would be a literal in disguise.
 */
export function coverageCounts(views: readonly CoverageView[]): { total: number; empty: number; holes: number } {
  return {
    total: views.length,
    empty: views.filter((v) => v.state === 'empty').length,
    holes: views.filter((v) => v.state === 'holes').length,
  };
}

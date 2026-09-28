/**
 * IB-012 — the coverage report (§5: `results/coverage.md`, per symbol × series: first row, last
 * row, missing months).
 *
 * This is the backfill's counterpart to IB-011's daily gap report, and it inherits that report's
 * rule: **it must not cry wolf.** The venues do not serve everything, and the depths below are
 * measured, not assumed:
 *
 * - Binance 5-minute metrics (OI and the four L/S ratios) start **2020-09 for BTCUSDT and
 *   2021-12 for every other symbol** — 404 before that, forever.
 * - OKX funding REST serves roughly the **last 97 days** and nothing earlier; every day it is
 *   not collected is lost for good.
 * - Liquidations, predicted funding and mark price have no history at all: forward only.
 *
 * A month below a series' floor is reported as `unavailable` — a fact about the venue. Only a
 * month inside the served window with no rows is `missing`, which is a real hole worth chasing.
 */

import { monthsBetween, type Month } from './calendar-range';

export type SeriesKey =
  | 'candles_1m_perp'
  | 'candles_1m_spot'
  | 'funding_binance'
  | 'funding_bybit'
  | 'funding_okx'
  | 'open_interest_5m'
  | 'long_short_5m';

export interface SeriesCoverageInput {
  symbol: string;
  series: SeriesKey;
  /** The months that actually hold at least one row. */
  monthsPresent: readonly Month[];
  /** The first month the backfill asked for (the symbol's listing, or the window's start). */
  requestedFrom: Month;
  requestedTo: Month;
  /**
   * The first month this venue/series serves at all, when it is known and later than
   * `requestedFrom`. Months before it are `unavailable`, not `missing`.
   */
  servedFrom?: Month | null;
  firstRow?: string | null;
  lastRow?: string | null;
  rows: number;
}

export interface SeriesCoverage {
  symbol: string;
  series: SeriesKey;
  rows: number;
  firstRow: string | null;
  lastRow: string | null;
  /** Months inside the served window with no rows — real holes. */
  missingMonths: Month[];
  /** Months the venue never served — a fact, not a hole. */
  unavailableMonths: Month[];
  complete: boolean;
}

export function buildSeriesCoverage(input: SeriesCoverageInput): SeriesCoverage {
  const present = new Set(input.monthsPresent);
  const all = monthsBetween(input.requestedFrom, input.requestedTo);
  const floor = input.servedFrom ?? null;

  const unavailableMonths = floor ? all.filter((m) => m < floor) : [];
  const missingMonths = all.filter((m) => (!floor || m >= floor) && !present.has(m));

  return {
    symbol: input.symbol,
    series: input.series,
    rows: input.rows,
    firstRow: input.firstRow ?? null,
    lastRow: input.lastRow ?? null,
    missingMonths,
    unavailableMonths,
    complete: missingMonths.length === 0,
  };
}

const SERIES_LABEL: Record<SeriesKey, string> = {
  candles_1m_perp: '1m candles (perp)',
  candles_1m_spot: '1m candles (spot)',
  funding_binance: 'funding (Binance)',
  funding_bybit: 'funding (Bybit)',
  funding_okx: 'funding (OKX)',
  open_interest_5m: 'open interest 5m',
  long_short_5m: 'long/short 5m',
};

/** Collapses a month list to `2021-01..2021-06, 2022-03` so a 60-month hole is one cell. */
export function summariseMonths(months: readonly Month[]): string {
  if (months.length === 0) return '—';
  const sorted = [...months].sort();
  const runs: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  const advance = (m: Month) => {
    const [y, mm] = m.split('-').map(Number);
    return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  };
  for (const month of sorted.slice(1)) {
    if (month === advance(previous)) { previous = month; continue; }
    runs.push(start === previous ? start : `${start}..${previous}`);
    start = month;
    previous = month;
  }
  runs.push(start === previous ? start : `${start}..${previous}`);
  return runs.join(', ');
}

export function renderCoverageMarkdown(rows: readonly SeriesCoverage[], generatedAt: Date): string {
  const lines: string[] = [];
  lines.push('# insight-bot historical backfill — coverage');
  lines.push('');
  lines.push(`Generated ${generatedAt.toISOString()} by \`npm run backfill\` (IB-012, design §5).`);
  lines.push('');
  lines.push('`missing` is a hole worth chasing. `unavailable` is a month the venue never served —');
  lines.push('the Binance 5-minute metrics archive starts 2020-09 for BTCUSDT and 2021-12 for every');
  lines.push('other symbol, and OKX funding REST serves only about the last 97 days. Neither is a gap,');
  lines.push('and the daily gap report must not count them as one.');
  lines.push('');
  lines.push('| Symbol | Series | Rows | First row | Last row | Missing | Unavailable |');
  lines.push('|---|---|---|---:|---|---|---|');
  for (const row of rows) {
    lines.push([
      '', row.symbol, SERIES_LABEL[row.series], String(row.rows),
      row.firstRow ?? '—', row.lastRow ?? '—',
      summariseMonths(row.missingMonths), summariseMonths(row.unavailableMonths), '',
    ].join(' | ').trim());
  }
  lines.push('');
  const incomplete = rows.filter((r) => !r.complete);
  lines.push(incomplete.length === 0
    ? '**Every series is complete inside the window each venue serves.**'
    : `**${incomplete.length} series have real holes**: ${incomplete.map((r) => `${r.symbol}/${r.series}`).join(', ')}.`);
  return lines.join('\n');
}

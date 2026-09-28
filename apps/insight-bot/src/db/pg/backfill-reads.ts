import type { Db } from '../db.port';

/**
 * IB-012 — the reads the historical backfill needs (SQL stays in `src/db/pg/`, IB-004's rule).
 *
 * Two jobs: tell the runner which months are already stored, so a re-run resumes instead of
 * re-downloading years (§5: "idempotent and resumable by month"), and give the coverage report
 * its first row, last row and count per series.
 */

/** A table the backfill writes, with the timestamp column that orders it. */
export interface SeriesTable {
  table: string;
  timeColumn: string;
}

export const SERIES_TABLES = {
  candles: { table: 'candles_1m', timeColumn: 'open_time' },
  funding: { table: 'funding_settlements', timeColumn: 'funding_time' },
  openInterest: { table: 'open_interest_5m', timeColumn: 'ts' },
  longShort: { table: 'long_short_5m', timeColumn: 'ts' },
} as const satisfies Record<string, SeriesTable>;

export interface SeriesFilter {
  venue: string;
  symbol: string;
  /** `candles_1m` only. */
  market?: string;
}

function where(filter: SeriesFilter): { sql: string; params: unknown[] } {
  const params: unknown[] = [filter.venue, filter.symbol];
  let sql = 'venue = $1 and symbol = $2';
  if (filter.market) {
    params.push(filter.market);
    sql += ` and market = $${params.length}`;
  }
  return { sql, params };
}

/** The `YYYY-MM` months that already hold at least one row for this series. */
export async function monthsWithRows(db: Db, table: SeriesTable, filter: SeriesFilter): Promise<string[]> {
  const { sql, params } = where(filter);
  const rows = await db.query<{ month: string }>(
    `select to_char(date_trunc('month', ${table.timeColumn}), 'YYYY-MM') as month
       from ${table.table}
      where ${sql}
      group by 1
      order by 1`,
    params,
  );
  return rows.map((r) => r.month);
}

export interface SeriesExtent {
  rows: number;
  firstRow: string | null;
  lastRow: string | null;
}

/** Count, first and last timestamp for one series — the coverage report's three numbers. */
export async function seriesExtent(db: Db, table: SeriesTable, filter: SeriesFilter): Promise<SeriesExtent> {
  const { sql, params } = where(filter);
  const rows = await db.query<{ n: string; first_row: Date | null; last_row: Date | null }>(
    `select count(*) as n, min(${table.timeColumn}) as first_row, max(${table.timeColumn}) as last_row
       from ${table.table}
      where ${sql}`,
    params,
  );
  const row = rows[0];
  return {
    rows: Number(row?.n ?? 0),
    firstRow: row?.first_row ? new Date(row.first_row).toISOString() : null,
    lastRow: row?.last_row ? new Date(row.last_row).toISOString() : null,
  };
}

/**
 * The 1m bars stored for one UTC day, keyed by open time — the archive/live agreement check the
 * task asks for (spot check of 1440 bars on an overlapping day).
 */
export async function candlesForDay(
  db: Db,
  filter: Required<SeriesFilter>,
  dayStart: Date,
  dayEnd: Date,
  source?: string,
): Promise<Array<{ openTime: number; open: number; high: number; low: number; close: number; volume: number; source: string }>> {
  const params: unknown[] = [filter.venue, filter.symbol, filter.market, dayStart, dayEnd];
  let sql = 'venue = $1 and symbol = $2 and market = $3 and open_time >= $4 and open_time < $5';
  if (source) {
    params.push(source);
    sql += ` and source = $${params.length}`;
  }
  const rows = await db.query<{ open_time: Date; open: string; high: string; low: string; close: string; volume: string; source: string }>(
    `select open_time, open, high, low, close, volume, source
       from candles_1m
      where ${sql}
      order by open_time`,
    params,
  );
  return rows.map((r) => ({
    openTime: new Date(r.open_time).getTime(),
    open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
    volume: Number(r.volume), source: r.source,
  }));
}

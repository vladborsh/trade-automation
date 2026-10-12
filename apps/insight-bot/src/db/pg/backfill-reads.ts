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

/**
 * The `YYYY-MM` months that already hold at least one row for this series.
 *
 * **IB-042 — this was a full scan per series, and it made `/api/web/coverage` unable to finish.**
 * The old shape was `group by date_trunc('month', …)`, which has to read every row of the series
 * to learn which months exist: dev-3 measured **16 735 ms for one symbol** on a populated slot
 * (21.6 M candle rows), and the controller runs about 120 of these — 30 symbols × 4 series — so
 * the request never completed at all.
 *
 * The shape now: find the extent, generate the months between it, and probe each month with an
 * indexed `exists`. A scan of ~1.4 M rows becomes ~83 index seeks, because every series table is
 * keyed on `(venue, market, symbol, time)` or `(venue, symbol, time)` and each probe is a range
 * on that key's tail. Measured on `insight_dev2` (8.3 M candle rows), BTCUSDT, five runs each:
 *
 * | shape | runs (ms) |
 * |---|---|
 * | old — group by month | 1717, 723, 600, 493, 469 |
 * | **this — extent + `exists` per month** | **30, 34, 6, 7, 8** |
 * | one grouped pass for all 30 symbols at once | 623, 930, 956 — per *series*, so ~4 s a page |
 *
 * The grouped pass was the obvious alternative and it also fixes the page (~4 s instead of
 * minutes), but it is roughly 100× slower than this per call and it would have changed the
 * function's signature — the backfill asks about one series at a time, and handing it a
 * whole-universe query would make it pay for 29 symbols it is not backfilling.
 *
 * **`exists` per month, not "every month between first and last".** That shortcut is wrong in
 * exactly the case this function exists to find: a series with a hole in the middle would report
 * the hole as present, and `missingBetween` would then report nothing missing. The probe is what
 * makes the answer identical to the scan's; `backfill-reads.months.integration.spec.ts` asserts
 * that against the old implementation, hole included.
 */
export async function monthsWithRows(db: Db, table: SeriesTable, filter: SeriesFilter): Promise<string[]> {
  const { sql, params } = where(filter);
  const rows = await db.query<{ month: string }>(
    `with bounds as (
       select min(${table.timeColumn}) as lo, max(${table.timeColumn}) as hi
         from ${table.table}
        where ${sql}
     ),
     months as (
       select generate_series(
                date_trunc('month', lo),
                date_trunc('month', hi),
                interval '1 month'
              ) as m
         from bounds
        where lo is not null
     )
     select to_char(m, 'YYYY-MM') as month
       from months
      where exists (
        -- bare column names bind to the probe row here: it is the only relation in scope with
        -- them, and the months CTE carries nothing but m
        select 1 from ${table.table} probe
         where ${sql}
           and probe.${table.timeColumn} >= m
           and probe.${table.timeColumn} < m + interval '1 month'
      )
      order by m`,
    params,
  );
  return rows.map((r) => r.month);
}

export interface SeriesExtent {
  rows: number;
  firstRow: string | null;
  lastRow: string | null;
}

/**
 * IB-042 — first and last timestamp only, with **no `count(*)`**.
 *
 * `seriesExtent` below also returns a row count, and that count is what made the coverage page
 * slow even after `monthsWithRows` was fixed: counting rows cannot use the index's edges, it has
 * to visit every row of the series. Measured on `insight_dev2`, BTCUSDT:
 *
 * | query | runs (ms) |
 * |---|---|
 * | `count(*)` + `min` + `max` (what the page used) | 863, 158, 149, 147 |
 * | **`min` + `max` alone (this)** | **4.3, 3.5, 3.4, 3.4** |
 *
 * The page never used the count — `coverage.controller.ts` reads `firstRow` and `lastRow` and
 * nothing else — so it was paying a full scan per series, 120 times, for a number it discarded.
 *
 * `seriesExtent` keeps the count and stays exactly as it was, because the backfill's own report
 * does use it (`backfill.runner.ts`). Two callers wanting different things is a reason for two
 * functions, not for one function that is wrong for one of them.
 */
export async function seriesBounds(db: Db, table: SeriesTable, filter: SeriesFilter): Promise<Omit<SeriesExtent, 'rows'>> {
  const { sql, params } = where(filter);
  const rows = await db.query<{ first_row: Date | null; last_row: Date | null }>(
    `select min(${table.timeColumn}) as first_row, max(${table.timeColumn}) as last_row
       from ${table.table}
      where ${sql}`,
    params,
  );
  const row = rows[0];
  return {
    firstRow: row?.first_row ? new Date(row.first_row).toISOString() : null,
    lastRow: row?.last_row ? new Date(row.last_row).toISOString() : null,
  };
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

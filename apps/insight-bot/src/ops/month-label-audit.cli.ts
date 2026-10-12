import { PgDatabase } from '../db/pg/pg-database';

/**
 * IB-043 — how many month LABELS does this database disagree with itself about?
 *
 * `date_trunc('month', ts)` on a `timestamptz` truncates in the **session** zone. Both callers of
 * `monthsWithRows` label months in UTC (`getUTCMonth` on the page, `YYYY-MM-01T00:00:00.000Z` in
 * the backfill's `calendar-range.ts`), so before IB-043 the two disagreed on any row sitting
 * within the session's UTC offset of a month boundary. The coverage page reported a month that
 * held data as missing, and — worse — the backfill's resume filter saw a month it had never
 * downloaded as already stored and skipped it for good.
 *
 * This reports the damage as a **number**, per database, so "latent" is a measurement and not a
 * hope. A non-zero `sessionOnly` is rows the old code filed under the wrong month.
 *
 * Run: `npm run audit:months` with `DATABASE_URL` set. Read-only; safe on a live database.
 *
 * Measured 2026-10-12, both at session zone `US/Pacific`:
 *
 * | database | sessionOnly | utcOnly | note |
 * |---|---|---|---|
 * | `insight_coord` | 0 | 0 | dense series mask it — every month has mid-month rows too |
 * | `insight_dev2` | **2** | 0 | `candles_1m/BTCUSDT/2019-12` and `funding_settlements/BTCUSDT/2026-08` |
 *
 * Both of the dev-2 labels are phantoms created by a first/last row landing exactly on a UTC
 * month boundary — BTCUSDT's candles begin at `2020-01-01T00:00Z`, which is `2019-12-31 16:00`
 * in Pacific. Neither was user-visible, because `missingBetween` only asks about months inside
 * the extent and both phantoms fall outside it. The mechanism is proven and the realisation is a
 * **fresh backfill into an empty database** — the box's first boot — where the phantom lands
 * inside the range being fetched.
 */

const TABLES: ReadonlyArray<{ table: string; timeColumn: string }> = [
  { table: 'candles_1m', timeColumn: 'open_time' },
  { table: 'funding_settlements', timeColumn: 'funding_time' },
  { table: 'open_interest_5m', timeColumn: 'ts' },
  { table: 'long_short_5m', timeColumn: 'ts' },
  { table: 'liquidations', timeColumn: 'ts' },
];

const labels = (zone: 'session' | 'utc') => TABLES.map(({ table, timeColumn }) => {
  const expr = zone === 'utc' ? `${timeColumn} at time zone 'UTC'` : timeColumn;
  return `select '${table}' as t, venue, symbol, to_char(date_trunc('month', ${expr}), 'YYYY-MM') as m
            from ${table} group by 1, 2, 3, 4`;
}).join('\n  union all ');

export interface MonthLabelAudit {
  sessionOnly: number;
  utcOnly: number;
  sessionTotal: number;
  utcTotal: number;
  rows: Array<{ table: string; venue: string; symbol: string; month: string }>;
}

export async function auditMonthLabels(db: PgDatabase): Promise<MonthLabelAudit> {
  const sql = `with sess as (${labels('session')}), utc as (${labels('utc')})`;
  const [counts] = await db.query<{ session_only: string; utc_only: string; sess_total: string; utc_total: string }>(
    `${sql}
     select (select count(*) from (select * from sess except select * from utc) a) as session_only,
            (select count(*) from (select * from utc except select * from sess) b) as utc_only,
            (select count(*) from sess) as sess_total,
            (select count(*) from utc) as utc_total`,
  );
  const rows = await db.query<{ t: string; venue: string; symbol: string; m: string }>(
    `${sql} select * from (select * from sess except select * from utc) a order by 1, 2, 3, 4 limit 200`,
  );
  return {
    sessionOnly: Number(counts?.session_only ?? 0),
    utcOnly: Number(counts?.utc_only ?? 0),
    sessionTotal: Number(counts?.sess_total ?? 0),
    utcTotal: Number(counts?.utc_total ?? 0),
    rows: rows.map((r) => ({ table: r.t, venue: r.venue, symbol: r.symbol, month: r.m })),
  };
}

/* istanbul ignore next -- the CLI shell; `auditMonthLabels` is what the spec exercises */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(2);
  }
  const db = new PgDatabase(url);
  try {
    const [{ TimeZone: zone }] = await db.query<{ TimeZone: string }>('show timezone');
    const audit = await auditMonthLabels(db);
    console.log(`session zone        : ${zone}`);
    console.log(`labels (session/UTC): ${audit.sessionTotal} / ${audit.utcTotal}`);
    console.log(`session-only labels : ${audit.sessionOnly}`);
    console.log(`UTC-only labels     : ${audit.utcOnly}`);
    for (const row of audit.rows) {
      console.log(`  mislabelled: ${row.table} ${row.venue} ${row.symbol} -> ${row.month}`);
    }
    // non-zero exit so a cron or a boot check can gate on it
    process.exit(audit.sessionOnly === 0 && audit.utcOnly === 0 ? 0 : 1);
  } finally {
    await db.end();
  }
}

if (require.main === module) void main();

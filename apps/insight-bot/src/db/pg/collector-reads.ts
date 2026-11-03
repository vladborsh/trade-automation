import type { Db } from '../db.port';

/** The same shape for a 5-minute grid (`open_interest_5m`, `long_short_5m`). */
export async function slotCoverage(
  db: Db,
  table: 'open_interest_5m' | 'long_short_5m',
  dayStart: Date,
  dayEnd: Date,
): Promise<Array<{ venue: string; symbol: string; present: number; expected: number }>> {
  const rows = await db.query<{ venue: string; symbol: string; present: string; expected: string }>(
    `with first_seen as (
       select venue, symbol, min(ts) as first_ts from ${table} group by venue, symbol
     )
     select f.venue, f.symbol,
            count(distinct t.ts) as present,
            greatest(0, floor(extract(epoch from ($2::timestamptz - greatest($1::timestamptz, f.first_ts))) / 300)::bigint) as expected
       from first_seen f
       left join ${table} t
         on t.venue = f.venue and t.symbol = f.symbol and t.ts >= $1 and t.ts < $2
      where f.first_ts < $2
      group by f.venue, f.symbol, f.first_ts`,
    [dayStart, dayEnd],
  );
  return rows.map((r) => ({ venue: r.venue, symbol: r.symbol, present: Number(r.present), expected: Number(r.expected) }));
}

/** `collector_gaps` detected during the day. */
export async function gapsForDay(db: Db, dayStart: Date, dayEnd: Date): Promise<
  Array<{ stream: string; venue: string; symbol: string | null; gapFromMs: number; gapToMs: number; expected: number; repaired: number; error: string | null }>
> {
  const rows = await db.query<{ stream: string; venue: string; symbol: string | null; gap_from: Date; gap_to: Date; expected: number; repaired: number; error: string | null }>(
    `select stream, venue, symbol, gap_from, gap_to, expected, repaired, error
       from collector_gaps
      where detected_at >= $1 and detected_at < $2
      order by detected_at`,
    [dayStart, dayEnd],
  );
  return rows.map((r) => ({
    stream: r.stream, venue: r.venue, symbol: r.symbol,
    gapFromMs: new Date(r.gap_from).getTime(), gapToMs: new Date(r.gap_to).getTime(),
    expected: Number(r.expected), repaired: Number(r.repaired), error: r.error,
  }));
}

/** Stores one day's report; re-running the job for the same day replaces it. */
export async function saveGapReport(db: Db, day: string, report: unknown, clean: boolean): Promise<void> {
  await db.query(
    `insert into gap_reports (day, report, clean) values ($1, $2, $3)
     on conflict (day) do update set report = excluded.report, clean = excluded.clean, created_at = now()`,
    [day, JSON.stringify(report), clean],
  );
}

import type { Db } from '../db.port';
import type { Market } from '../../collectors/writers/tables';

/**
 * The one read the collectors need, kept here because SQL lives in `src/db/pg/` and the writers
 * module only (IB-004's rule): on boot a collector seeds `GapRepair` from the newest stored bar
 * per symbol and REST-fills the interval to now, so a restart never leaves a hole (§4.1, D12).
 */
export async function lastCandleOpenTimes(db: Db, venue: string, market: Market): Promise<Map<string, number>> {
  const rows = await db.query<{ symbol: string; open_time: Date }>(
    `select symbol, max(open_time) as open_time
       from candles_1m
      where venue = $1 and market = $2
      group by symbol`,
    [venue, market],
  );
  return new Map(rows.map((row) => [row.symbol, new Date(row.open_time).getTime()]));
}

/**
 * IB-008: the earliest settlement stored per symbol for a venue, so the boot funding backfill can
 * stop as soon as it reaches known rows instead of paging the venue's whole depth every restart.
 */
export async function earliestFundingTimes(db: Db, venue: string): Promise<Map<string, number>> {
  const rows = await db.query<{ symbol: string; funding_time: Date }>(
    `select symbol, min(funding_time) as funding_time
       from funding_settlements
      where venue = $1
      group by symbol`,
    [venue],
  );
  return new Map(rows.map((row) => [row.symbol, new Date(row.funding_time).getTime()]));
}

/**
 * IB-011 — everything the daily gap report reads, in one place (SQL lives in `src/db/pg/`).
 *
 * `expected` is counted from the collector's **first row for that series**, never from midnight:
 * a collector that started at noon did not "miss" the morning, and a report that says it did
 * teaches the reader to ignore reports (§6.2 is the stage-0 instrument).
 */
export async function candleCoverage(db: Db, dayStart: Date, dayEnd: Date): Promise<
  Array<{ venue: string; market: string; symbol: string; present: number; expected: number }>
> {
  const rows = await db.query<{ venue: string; market: string; symbol: string; present: string; expected: string }>(
    `with first_seen as (
       select venue, market, symbol, min(open_time) as first_open_time
         from candles_1m
        group by venue, market, symbol
     )
     select f.venue, f.market, f.symbol,
            count(c.open_time) as present,
            greatest(0, floor(extract(epoch from ($2::timestamptz - greatest($1::timestamptz, f.first_open_time))) / 60)::bigint) as expected
       from first_seen f
       left join candles_1m c
         on c.venue = f.venue and c.market = f.market and c.symbol = f.symbol
        and c.open_time >= $1 and c.open_time < $2
      where f.first_open_time < $2
      group by f.venue, f.market, f.symbol, f.first_open_time`,
    [dayStart, dayEnd],
  );
  return rows.map((r) => ({ venue: r.venue, market: r.market, symbol: r.symbol, present: Number(r.present), expected: Number(r.expected) }));
}

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

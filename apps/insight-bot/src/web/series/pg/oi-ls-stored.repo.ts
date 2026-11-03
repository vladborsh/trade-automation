import type { Db } from '../../../db/db.port';
import type { OiLsStoredReader } from '../../market/oi-ls.service';

/**
 * IB-080 (storage ruling 2026-11-03 S3, S4) — the STORED half of `/series/oi` and `/series/ls`:
 * Binance open interest and long/short rows the OI/LS poller wrote, read only for the part of a
 * window that is older than what the venue still serves. SQL under `pg/`, IB-004's rule.
 *
 * **One granularity per answer (S4).** The venue part is asked at period P; this part is sampled
 * at P too, in SQL: the LAST row per `date_bin(P, ts, epoch)` bucket, so a year of 5-minute rows
 * is ~P-many points rather than 105 k, and the line looks the same on both sides of the boundary.
 * Each point keeps its row's own `ts`.
 *
 * Venue is always `binance` and the symbol is the venue spelling (the universe id is the Binance
 * perp symbol) — the poller writes nothing else.
 */
const asDate = (ms: number) => new Date(ms);
const VENUE = 'binance';

/** Whether ANY stored row exists in [fromMs, toMs) — decides whether the joined path is taken at all. */
export async function hasStoredOi(db: Db, q: { symbol: string; fromMs: number; toMs: number }): Promise<boolean> {
  const rows = await db.query<{ one: number }>(
    'select 1 as one from open_interest_5m where venue = $1 and symbol = $2 and ts >= $3 and ts < $4 limit 1',
    [VENUE, q.symbol, asDate(q.fromMs), asDate(q.toMs)],
  );
  return rows.length > 0;
}

export async function hasStoredLs(db: Db, q: { symbol: string; kind: string; fromMs: number; toMs: number }): Promise<boolean> {
  const rows = await db.query<{ one: number }>(
    'select 1 as one from long_short_5m where venue = $1 and symbol = $2 and kind = $3 and ratio is not null and ts >= $4 and ts < $5 limit 1',
    [VENUE, q.symbol, q.kind, asDate(q.fromMs), asDate(q.toMs)],
  );
  return rows.length > 0;
}

export interface StoredOiPoint {
  timeMs: number;
  oiBase: number;
  oiQuote: number | null;
}

/** The last row per P-bucket in [fromMs, toMs), oldest first. */
export async function storedOi(db: Db, q: { symbol: string; fromMs: number; toMs: number; periodMs: number }): Promise<StoredOiPoint[]> {
  const rows = await db.query<{ ts: Date; oi_base: string; oi_quote: string | null }>(
    `select ts, oi_base, oi_quote from (
       select distinct on (date_bin(make_interval(secs => $5::double precision / 1000), ts, timestamptz 'epoch'))
              ts, oi_base, oi_quote
         from open_interest_5m
        where venue = $1 and symbol = $2 and ts >= $3 and ts < $4
        order by date_bin(make_interval(secs => $5::double precision / 1000), ts, timestamptz 'epoch'), ts desc
     ) last_per_bucket
     order by ts`,
    [VENUE, q.symbol, asDate(q.fromMs), asDate(q.toMs), q.periodMs],
  );
  return rows.map((r) => ({
    timeMs: new Date(r.ts).getTime(),
    oiBase: Number(r.oi_base),
    oiQuote: r.oi_quote === null ? null : Number(r.oi_quote),
  }));
}

export interface StoredRatioPoint {
  timeMs: number;
  ratio: number;
}

export async function storedLs(
  db: Db, q: { symbol: string; kind: string; fromMs: number; toMs: number; periodMs: number },
): Promise<StoredRatioPoint[]> {
  const rows = await db.query<{ ts: Date; ratio: number }>(
    `select ts, ratio from (
       select distinct on (date_bin(make_interval(secs => $6::double precision / 1000), ts, timestamptz 'epoch'))
              ts, ratio
         from long_short_5m
        where venue = $1 and symbol = $2 and kind = $3 and ratio is not null and ts >= $4 and ts < $5
        order by date_bin(make_interval(secs => $6::double precision / 1000), ts, timestamptz 'epoch'), ts desc
     ) last_per_bucket
     order by ts`,
    [VENUE, q.symbol, q.kind, asDate(q.fromMs), asDate(q.toMs), q.periodMs],
  );
  return rows.map((r) => ({ timeMs: new Date(r.ts).getTime(), ratio: Number(r.ratio) }));
}

/** The read-only port `OiLsService` takes (IB-080): the service itself never sees the database. */
export function oiLsStoredReader(db: Db): OiLsStoredReader {
  return {
    hasOi: (symbol, fromMs, toMs) => hasStoredOi(db, { symbol, fromMs, toMs }),
    oi: (symbol, fromMs, toMs, periodMs) => storedOi(db, { symbol, fromMs, toMs, periodMs }),
    hasLs: (symbol, kind, fromMs, toMs) => hasStoredLs(db, { symbol, kind, fromMs, toMs }),
    ls: (symbol, kind, fromMs, toMs, periodMs) => storedLs(db, { symbol, kind, fromMs, toMs, periodMs }),
  };
}

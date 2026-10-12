import type { Db } from '../db.port';
import type { Market } from '../../collectors/writers/tables';
import type { Heartbeat } from '../../collectors/uptime/uptime-gap';

/**
 * IB-BUG-010 — the reads and writes behind collector coverage. SQL lives in `src/db/pg/` (IB-004).
 *
 * Kept in its own file rather than added to `collector-reads.ts` deliberately: that file is read by
 * the daily gap report and by three collectors, and dev-1 and dev-2 are both in this app this week.
 * A new file is a merge conflict that cannot happen.
 */

/** Reads every stream's persisted liveness, keyed by stream. */
export async function heartbeats(db: Db): Promise<Map<string, Heartbeat>> {
  const rows = await db.query<{ stream: string; venue: string; market: Market | null; first_seen_at: Date; last_seen_at: Date }>(
    `select stream, venue, market, first_seen_at, last_seen_at from collector_heartbeats`,
    [],
  );
  return new Map(rows.map((r) => [r.stream, {
    stream: r.stream,
    venue: r.venue,
    market: r.market,
    firstSeenAt: new Date(r.first_seen_at),
    lastSeenAt: new Date(r.last_seen_at),
  }]));
}

/**
 * Marks a stream alive at `at`.
 *
 * `first_seen_at` is written once and never moved: it is the instant before which no coverage may
 * be claimed, so letting an upsert overwrite it would quietly erase the fact that we did not exist
 * yet. `last_seen_at` only ever moves forward — `greatest()` rather than assignment, so an
 * out-of-order tick or a clock step cannot walk liveness backwards and manufacture a gap.
 */
export async function touchHeartbeat(
  db: Db,
  stream: { stream: string; venue: string; market?: Market | null },
  at: Date,
): Promise<void> {
  await db.query(
    `insert into collector_heartbeats (stream, venue, market, first_seen_at, last_seen_at)
          values ($1, $2, $3, $4, $4)
     on conflict (stream) do update
            set last_seen_at = greatest(collector_heartbeats.last_seen_at, excluded.last_seen_at),
                venue        = excluded.venue,
                market       = excluded.market`,
    [stream.stream, stream.venue, stream.market ?? null, at],
  );
}

/** The gap rows overlapping a window, for the covered-hours arithmetic. */
export async function gapsOverlapping(
  db: Db,
  from: Date,
  to: Date,
  streams: readonly string[],
): Promise<Array<{ stream: string; gapFrom: Date; gapTo: Date; error: string | null }>> {
  if (streams.length === 0) return [];
  const rows = await db.query<{ stream: string; gap_from: Date; gap_to: Date; error: string | null }>(
    // overlap, not containment: a gap that started before the window or runs past its end still
    // removes covered time from inside it, and `coveredMs` clips it
    `select stream, gap_from, gap_to, error
       from collector_gaps
      where stream = any($3) and gap_from < $2 and gap_to > $1
      order by gap_from`,
    [from, to, streams as string[]],
  );
  return rows.map((r) => ({
    stream: r.stream,
    gapFrom: new Date(r.gap_from),
    gapTo: new Date(r.gap_to),
    error: r.error,
  }));
}

/**
 * IB-BUG-010, second half — liquidation rows whose `(venue, symbol)` matches no spelling in
 * `symbols`.
 *
 * `liquidations.symbol` holds the **venue's own** spelling (`BTCUSDT` on binance and bybit,
 * `BTC-USDT-SWAP` on okx), not the canonical `symbols.id`. A row whose spelling is in no column is
 * therefore unreachable from any canonical id: it sits in the table, is counted by nothing, and
 * reaches no page. dev-2 measured 0 of these on 2026-10-07 and I measured 0 again on 2026-10-12 —
 * two observations, both zero, which is a note and not a guarantee. The point of surfacing it is
 * the day it stops being zero, which is the day a venue renames a contract.
 *
 * Grouped by `(venue, symbol)` so the answer names the spellings rather than only counting them;
 * a bare total tells you something is wrong without telling you what to fix.
 */
export async function unmappedLiquidations(
  db: Db,
  limit = 20,
): Promise<{ total: number; rows: Array<{ venue: string; symbol: string; rows: number }> }> {
  const sql = `
      from liquidations l
     where not exists (
       select 1 from symbols s
        where (l.venue = 'binance' and l.symbol in (s.binance_perp, s.binance_spot))
           or (l.venue = 'bybit'   and l.symbol = s.bybit_linear)
           or (l.venue = 'okx'     and l.symbol = s.okx_swap))`;

  const [total] = await db.query<{ n: string }>(`select count(*) as n ${sql}`, []);
  const rows = await db.query<{ venue: string; symbol: string; n: string }>(
    `select l.venue, l.symbol, count(*) as n ${sql} group by l.venue, l.symbol order by count(*) desc limit $1`,
    [limit],
  );
  return {
    total: Number(total?.n ?? 0),
    rows: rows.map((r) => ({ venue: r.venue, symbol: r.symbol, rows: Number(r.n) })),
  };
}

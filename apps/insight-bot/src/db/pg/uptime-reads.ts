import type { Db } from '../db.port';
import type { Market } from '../../collectors/writers/tables';
import type { Heartbeat } from '../../collectors/uptime/uptime-gap';

/**
 * IB-BUG-010 — the reads and writes behind collector uptime. SQL lives in `src/db/pg/` (IB-004).
 * WD-009: was `coverage-reads.ts`; the coverage page is gone and these now feed the liquidation
 * uptime block of `/api/web/health/streams` (and, as before, `UptimeRecorder`).
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
 * WD-009 — what each venue's liquidation collector WROTE in the last 7 days: the newest row, and how
 * many rows fell in the last 24 h and the last 7 days. Bounded by `from7d` on purpose: `liquidations`
 * is partitioned by time, and an unbounded `max(ts)` would touch every partition there is.
 */
export async function liquidationActivity(
  db: Db,
  from7d: Date,
  from24h: Date,
): Promise<Map<string, { lastRowAt: Date; rows24h: number; rows7d: number }>> {
  const rows = await db.query<{ venue: string; last_ts: Date; n24: string; n7: string }>(
    `select venue, max(ts) as last_ts,
            count(*) filter (where ts >= $2) as n24,
            count(*) as n7
       from liquidations
      where ts >= $1
      group by venue`,
    [from7d, from24h],
  );
  return new Map(rows.map((r) => [r.venue, { lastRowAt: new Date(r.last_ts), rows24h: Number(r.n24), rows7d: Number(r.n7) }]));
}

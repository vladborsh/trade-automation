import type { WebFeatureFrame, WebFrameBasis, WebFrameTimeframe } from '@trade-automation/contracts';
import type { DbHandle } from '../../db/db.port';
import type { ValueConflict } from '../frame-amendment';

/**
 * IB-015 — the `feature_frames` rows themselves: reading the published frame, appending a
 * revision, recording a conflict, and counting what the coverage page shows.
 *
 * SQL under a `pg/` directory, IB-004's rule.
 *
 * **Every read here takes the LATEST revision.** A frame amended at +60 s has two rows and the
 * older one is the audit trail, not the answer; a query that forgets `distinct on` silently
 * returns revision 1 for ever, which would make the whole amendment path invisible rather than
 * broken. `distinct on (symbol, tf, close_time) … order by …, revision desc` is the shape, and
 * it appears in every one of them.
 */

const asDate = (ms: number) => new Date(ms);
const sec = (d: Date) => Math.floor(new Date(d).getTime() / 1000);

interface FrameRow {
  symbol: string;
  tf: string;
  close_time: Date;
  frame_version: number;
  keys: WebFeatureFrame['keys'];
  basis: WebFrameBasis;
  complete: boolean;
  incomplete_reason: string[];
  revision: number;
  amended_at: Date | null;
  amended_keys: string[];
  computed_mode: 'live' | 'backfill';
  computed_at: Date;
}

function toFrame(row: FrameRow): WebFeatureFrame {
  return {
    symbol: row.symbol,
    tf: row.tf as WebFrameTimeframe,
    closeTime: sec(row.close_time),
    frameVersion: row.frame_version,
    keys: row.keys,
    basis: row.basis,
    complete: row.complete,
    incompleteReason: row.incomplete_reason,
    revision: row.revision,
    amendedAt: row.amended_at === null ? null : sec(row.amended_at),
    amendedKeys: row.amended_keys,
    computedMode: row.computed_mode,
    computedAt: sec(row.computed_at),
  };
}

const FRAME_COLUMNS =
  'symbol, tf, close_time, frame_version, keys, basis, complete, incomplete_reason, ' +
  'revision, amended_at, amended_keys, computed_mode, computed_at';

/**
 * The frame as currently published for a close, or null when nothing has been written for it.
 *
 * Null is what makes the re-check path decidable: a first write and an amendment are different
 * operations and the caller must not guess which one it is doing.
 */
export async function publishedFrame(
  db: DbHandle,
  symbol: string,
  tf: WebFrameTimeframe,
  closeTimeMs: number,
): Promise<WebFeatureFrame | null> {
  const rows = await db.query<FrameRow>(
    `select ${FRAME_COLUMNS}
       from feature_frames
      where symbol = $1 and tf = $2 and close_time = $3
      order by revision desc
      limit 1`,
    [symbol, tf, asDate(closeTimeMs)],
  );
  const row = rows[0];
  return row ? toFrame(row) : null;
}

/** Every published frame in a window, latest revision each, oldest first. */
export async function publishedFramesBetween(
  db: DbHandle,
  tf: WebFrameTimeframe,
  fromMs: number,
  toMsExclusive: number,
): Promise<WebFeatureFrame[]> {
  const rows = await db.query<FrameRow>(
    `select distinct on (symbol, tf, close_time) ${FRAME_COLUMNS}
       from feature_frames
      where tf = $1 and close_time >= $2 and close_time < $3
      order by symbol, tf, close_time, revision desc`,
    [tf, asDate(fromMs), asDate(toMsExclusive)],
  );
  return rows.map(toFrame).sort((a, b) => a.closeTime - b.closeTime);
}

/**
 * Appends a revision.
 *
 * `on conflict do nothing` on the full key, not `do update`: the table is append-only and a
 * revision that already exists is a re-run of the same work, not a correction. Re-running the
 * pass over a range must be safe — that is the whole point of the CLI — and the one thing it
 * must never do is rewrite a row something may already have armed on.
 */
export async function insertFrame(db: DbHandle, frame: WebFeatureFrame): Promise<boolean> {
  const rows = await db.query<{ revision: number }>(
    `insert into feature_frames
       (symbol, tf, close_time, frame_version, keys, basis, complete, incomplete_reason,
        revision, amended_at, amended_keys, computed_mode, computed_at)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::text[], $9, $10, $11::text[], $12, $13)
     on conflict (symbol, tf, close_time, revision) do nothing
     returning revision`,
    [
      frame.symbol,
      frame.tf,
      asDate(frame.closeTime * 1000),
      frame.frameVersion,
      JSON.stringify(frame.keys),
      JSON.stringify(frame.basis),
      frame.complete,
      frame.incompleteReason,
      frame.revision,
      frame.amendedAt === null ? null : asDate(frame.amendedAt * 1000),
      frame.amendedKeys,
      frame.computedMode,
      asDate(frame.computedAt * 1000),
    ],
  );
  return rows.length > 0;
}

/**
 * Records recomputes that would have changed a published value. The published value stands;
 * this is the evidence that an input moved under us.
 *
 * Expected to stay empty, which is what makes it worth writing to: a table that is routinely
 * non-empty tells nobody anything.
 */
export async function recordConflicts(
  db: DbHandle,
  at: { symbol: string; tf: WebFrameTimeframe; closeTimeMs: number; revision: number },
  conflicts: readonly ValueConflict[],
): Promise<void> {
  for (const conflict of conflicts) {
    await db.query(
      `insert into feature_value_conflicts
         (symbol, tf, close_time, revision, feature_key, published, recomputed)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        at.symbol,
        at.tf,
        asDate(at.closeTimeMs),
        at.revision,
        conflict.key,
        JSON.stringify(conflict.published),
        JSON.stringify(conflict.recomputed),
      ],
    );
  }
}

/**
 * Symbols whose published frame for a close still holds a chaseable refusal.
 *
 * What the +30 s and +60 s looks iterate over. §8.1's re-check exists because the closing bucket
 * was incomplete, so a frame with nothing chaseable left in it has nothing to re-check: running
 * it again would cost a full gather per symbol, three times per close, to confirm that nothing
 * changed.
 *
 * `incomplete_input` only, not `complete = false` — a frame refusing because the venue never
 * produced those minutes would otherwise be re-gathered every 30 seconds, for ever.
 */
export async function symbolsAwaitingHeal(
  db: DbHandle,
  tf: WebFrameTimeframe,
  closeTimeMs: number,
): Promise<string[]> {
  const rows = await db.query<{ symbol: string }>(
    `with latest as (
       select distinct on (symbol) symbol, keys
         from feature_frames
        where tf = $1 and close_time = $2
        order by symbol, revision desc
     )
     select symbol from latest
      where exists (
        select 1 from jsonb_each(keys) kv where kv.value->>'why' = 'incomplete_input'
      )
      order by symbol`,
    [tf, asDate(closeTimeMs)],
  );
  return rows.map((r) => r.symbol);
}

export interface FrameCountsRow {
  tf: string;
  written: number;
  incomplete: number;
  explainedOnly: number;
  unhealed: number;
  oldestUnhealedMs: number | null;
}

/**
 * The counts behind the coverage page's frame block.
 *
 * **`incomplete` is not `complete = false`.** The jsonb test below asks whether any key refused
 * with `incomplete_input` specifically, because that is the only refusal anyone can act on. A
 * frame whose refusals are all permanent — the venue never produced those minutes — is
 * `complete = false` for ever, and counting it as a problem would light an alarm that can never
 * be cleared. `explainedOnly` counts those separately so they stay visible without being
 * actionable.
 *
 * `unhealed` adds the deadline: before the heal window closes an incomplete frame is merely
 * young, and a counter that fires on young frames fires constantly during normal operation.
 */
export async function frameCounts(
  db: DbHandle,
  fromMs: number,
  toMsExclusive: number,
  healDeadlineMs: number,
): Promise<FrameCountsRow[]> {
  const rows = await db.query<{
    tf: string;
    written: string;
    incomplete: string;
    explained_only: string;
    unhealed: string;
    oldest_unhealed: Date | null;
  }>(
    `with latest as (
       select distinct on (symbol, tf, close_time) symbol, tf, close_time, keys, complete
         from feature_frames
        where close_time >= $1 and close_time < $2
        order by symbol, tf, close_time, revision desc
     ),
     flagged as (
       select tf, close_time, complete,
              exists (
                select 1 from jsonb_each(keys) kv
                 where kv.value->>'why' = 'incomplete_input'
              ) as chaseable
         from latest
     )
     select tf,
            count(*)                                               as written,
            count(*) filter (where chaseable)                      as incomplete,
            count(*) filter (where not complete and not chaseable) as explained_only,
            count(*) filter (where chaseable and close_time < $3)  as unhealed,
            min(close_time) filter (where chaseable and close_time < $3) as oldest_unhealed
       from flagged
      group by tf
      order by tf`,
    [asDate(fromMs), asDate(toMsExclusive), asDate(healDeadlineMs)],
  );
  return rows.map((r) => ({
    tf: r.tf,
    written: Number(r.written),
    incomplete: Number(r.incomplete),
    explainedOnly: Number(r.explained_only),
    unhealed: Number(r.unhealed),
    oldestUnhealedMs: r.oldest_unhealed === null ? null : new Date(r.oldest_unhealed).getTime(),
  }));
}

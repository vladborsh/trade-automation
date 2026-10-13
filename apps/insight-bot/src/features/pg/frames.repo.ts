import type { WebFeatureFrame, WebFrameBasis, WebFrameTimeframe } from '@trade-automation/contracts';
import type { DbHandle } from '../../db/db.port';
import type { ValueConflict } from '../frame-amendment';
import { featureSpecFingerprint } from '@trade-automation/contracts';
import { assertFrameVersionFingerprint } from '../frame-version-guard';

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
  spec_fingerprint: string;
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
    specFingerprint: row.spec_fingerprint,
  };
}

const FRAME_COLUMNS =
  'symbol, tf, close_time, frame_version, keys, basis, complete, incomplete_reason, ' +
  'revision, amended_at, amended_keys, computed_mode, computed_at, spec_fingerprint';

/**
 * The frame as currently published for a close **under one version**, or null when nothing has
 * been written for it.
 *
 * Null is what makes the re-check path decidable: a first write and an amendment are different
 * operations and the caller must not guess which one it is doing.
 *
 * **`frameVersion` is required and has no default (IB-053).** v1 and v2 frames for one close
 * coexist, so "the published frame" is not a question with an answer until a version is named.
 * Making the caller say which one is what makes a cross-version comparison impossible to
 * assemble rather than merely forbidden: `decideAmendment` can only ever be handed two frames of
 * the same version, so a difference it sees is always a difference in the DATA. A default would
 * have put the whole guarantee behind whichever version somebody forgot to pass.
 */
export async function publishedFrame(
  db: DbHandle,
  symbol: string,
  tf: WebFrameTimeframe,
  closeTimeMs: number,
  frameVersion: number,
): Promise<WebFeatureFrame | null> {
  const rows = await db.query<FrameRow>(
    `select ${FRAME_COLUMNS}
       from feature_frames
      where symbol = $1 and tf = $2 and close_time = $3 and frame_version = $4
      order by revision desc
      limit 1`,
    [symbol, tf, asDate(closeTimeMs), frameVersion],
  );
  const row = rows[0];
  return row ? toFrame(row) : null;
}

/**
 * One SPECIFIC revision of a frame, or null when that revision was never written.
 *
 * The playbook engine pins the revision it first evaluated a close against and comes back for
 * exactly that one (IB-017). Reading "the latest" there would let a sibling arm retried after a
 * heal see a better-informed frame than the arm it is being compared with — lookahead inside
 * live mode, through a door `computed_mode` does not cover.
 *
 * Revisions are append-only, so this is satisfiable whenever the pin was real; a null is a
 * genuine finding rather than an expected miss.
 *
 * **The pin is (revision, frameVersion) since IB-053.** A revision alone stopped identifying one
 * frame the moment v1 and v2 coexisted for a close, and this function would then have returned
 * an arbitrary one of two while still looking exact — which is worse than returning nothing.
 */
export async function frameAtRevision(
  db: DbHandle,
  symbol: string,
  tf: WebFrameTimeframe,
  closeTimeMs: number,
  revision: number,
  frameVersion: number,
): Promise<WebFeatureFrame | null> {
  const rows = await db.query<FrameRow>(
    `select ${FRAME_COLUMNS}
       from feature_frames
      where symbol = $1 and tf = $2 and close_time = $3 and revision = $4
        and frame_version = $5`,
    [symbol, tf, asDate(closeTimeMs), revision, frameVersion],
  );
  const row = rows[0];
  return row ? toFrame(row) : null;
}

/**
 * Every published frame in a window **of one version**, latest revision each, oldest first.
 *
 * `frameVersion` is required for the same reason as on `publishedFrame`, and here the old
 * signature was quietly worse than wrong: `distinct on (symbol, tf, close_time)` collapses a v1
 * and a v2 frame for one close into a SINGLE row and picks whichever sorted first. An audit over
 * a window would then have reported a mixture of two definitions as though it were one body of
 * results, with nothing in the output saying so. Verified against a real table before fixing:
 * two rows in, one row out.
 */
export async function publishedFramesBetween(
  db: DbHandle,
  tf: WebFrameTimeframe,
  fromMs: number,
  toMsExclusive: number,
  frameVersion: number,
): Promise<WebFeatureFrame[]> {
  const rows = await db.query<FrameRow>(
    `select distinct on (symbol, tf, close_time) ${FRAME_COLUMNS}
       from feature_frames
      where tf = $1 and close_time >= $2 and close_time < $3 and frame_version = $4
      order by symbol, tf, close_time, revision desc`,
    [tf, asDate(fromMs), asDate(toMsExclusive), frameVersion],
  );
  return rows.map(toFrame).sort((a, b) => a.closeTime - b.closeTime);
}

/**
 * Appends a revision, **claiming and verifying the frame version first**.
 *
 * `on conflict do nothing` on the full key, not `do update`: the table is append-only and a
 * revision that already exists is a re-run of the same work, not a correction. Re-running the
 * pass over a range must be safe — that is the whole point of the CLI — and the one thing it
 * must never do is rewrite a row something may already have armed on.
 *
 * **The version claim lives HERE, in the write primitive, so a caller cannot skip it** —
 * IB-049. It used to sit in `FeaturePassService.runPass`, and `features.cli --symbol` calls
 * `runClose` directly, so the bulk-backfill path wrote frames and claimed nothing:
 * `insight_dev1` reached 905 frames with an empty `feature_frame_versions`.
 *
 * That is worse than having no guard. With no claim row `checkFingerprint` returns early, so
 * the guard was silent by construction — and the first write through the claiming path would
 * have inserted the CURRENT fingerprint and retroactively legitimised 905 frames computed
 * under a different key set. An absent guard leaves you uncertain; one asserting something
 * false leaves you confident and wrong.
 *
 * Moving the call up a level would have been the same mistake one layer out: "remember to
 * claim before writing" is a rule, and today produced eight cases of rules losing to
 * mechanisms. Inside the primitive, the only way to write a frame is through the check.
 */
export async function insertFrame(db: DbHandle, frame: WebFeatureFrame): Promise<boolean> {
  await assertFrameVersionFingerprint(db, frame.frameVersion);
  const rows = await db.query<{ revision: number }>(
    `insert into feature_frames
       (symbol, tf, close_time, frame_version, keys, basis, complete, incomplete_reason,
        revision, amended_at, amended_keys, computed_mode, computed_at, spec_fingerprint)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::text[], $9, $10, $11::text[], $12, $13, $14)
     on conflict (symbol, tf, close_time, frame_version, revision) do nothing
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
      // Taken from the live registry at the moment of the write, never from the caller: a
      // frame must not be able to claim a spec it was not computed under.
      featureSpecFingerprint(),
    ],
  );
  return rows.length > 0;
}

/**
 * Records recomputes that would have changed a published value. The published value stands;
 * this is the evidence that an input moved under us.
 *
 * **Within one version only (IB-053).** Across versions the DEFINITION changed, so a difference
 * is expected rather than defective — `atr.4h.14` going value -> insufficient_history under v2 is
 * the new 71-bar window working, not an input moving. Such rows would bury the real findings
 * under every definition change we ever make, which is the failure IB-048 already cost us once.
 * The scoping is structural: this writes the version `publishedFrame` was asked for.
 *
 * Expected to stay empty, which is what makes it worth writing to: a table that is routinely
 * non-empty tells nobody anything.
 */
export async function recordConflicts(
  db: DbHandle,
  at: {
    symbol: string;
    tf: WebFrameTimeframe;
    closeTimeMs: number;
    revision: number;
    /**
     * The version BOTH sides were computed under (IB-053). Not the current registry version —
     * the version of the published frame being re-checked, which `publishedFrame` was asked for
     * and therefore returned.
     */
    frameVersion: number;
  },
  conflicts: readonly ValueConflict[],
): Promise<void> {
  for (const conflict of conflicts) {
    await db.query(
      `insert into feature_value_conflicts
         (symbol, tf, close_time, frame_version, revision, feature_key, published, recomputed)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        at.symbol,
        at.tf,
        asDate(at.closeTimeMs),
        at.frameVersion,
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

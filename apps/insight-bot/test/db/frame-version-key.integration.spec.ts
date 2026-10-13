import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import * as frames from '../../src/features/pg/frames.repo';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-053 — `frame_version` is part of a frame's identity, and of every pin that points at one.
 *
 * Against a real Postgres deliberately: the defect was a PRIMARY KEY, and a spec that fakes the
 * database cannot see a key. Every assertion here failed before migration 017 — the first three
 * by a duplicate-key violation, which is the thing the IB-052 ruling could not survive contact
 * with.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('frame-version-key.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const CLOSE = Date.UTC(2026, 9, 10, 0, 0, 0);
const SYMBOL = 'TRIALUSDT';

maybeDescribe('IB-053: frame_version in the key', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_versionkey', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db)
      .ensureRange(new Date(CLOSE - 40 * 86_400_000), new Date(CLOSE + 40 * 86_400_000));
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  beforeEach(async () => {
    // A neighbour's row left behind is how a negative assertion quietly stops asserting.
    await db.query('delete from feature_frames');
    await db.query('delete from feature_value_conflicts');
  });

  /** Raw insert, so the test exercises the KEY rather than the repo's opinion of it. */
  const put = (frameVersion: number, revision: number, keys: Record<string, unknown>) =>
    db.query(
      `insert into feature_frames
         (symbol, tf, close_time, frame_version, keys, basis, complete, incomplete_reason,
          revision, amended_keys, computed_mode, computed_at, spec_fingerprint)
       values ($1,'4h',$2,$3,$4::jsonb,'{}'::jsonb,true,'{}',$5,'{}','backfill',now(),$6)`,
      [SYMBOL, new Date(CLOSE), frameVersion, JSON.stringify(keys), revision, `fp-v${frameVersion}`],
    );

  const VALUE = { 'atr.4h.14': { ok: true, value: 10 } };
  // What v2 actually says for this close: 71 four-hourly bars are not there (IB-052).
  const REFUSED = { 'atr.4h.14': { ok: false, why: 'insufficient_history' } };

  it('lets a v2 frame exist for a close that already has a v1 frame', async () => {
    await put(1, 1, VALUE);
    // THIS is the line that threw `duplicate key value violates unique constraint
    // "feature_frames_pkey"` before 017, which made the "keep v1, write v2" ruling
    // unimplementable rather than merely unimplemented.
    await expect(put(2, 1, REFUSED)).resolves.toBeDefined();

    const rows = await db.query<{ frame_version: number }>(
      'select frame_version from feature_frames order by frame_version');
    expect(rows.map((r) => r.frame_version)).toEqual([1, 2]);
  });

  it('keeps amendments INSIDE a version: v1 reaches revision 2 while v2 is still at 1', async () => {
    await put(1, 1, VALUE);
    await put(1, 2, VALUE);
    await put(2, 1, REFUSED);

    const rows = await db.query<{ frame_version: number; max: number }>(
      'select frame_version, max(revision)::int as max from feature_frames group by 1 order by 1');
    expect(rows).toEqual([{ frame_version: 1, max: 2 }, { frame_version: 2, max: 1 }]);
  });

  it('publishedFrame answers for the version it is ASKED for, not the newest row', async () => {
    await put(1, 1, VALUE);
    await put(1, 2, VALUE);
    await put(2, 1, REFUSED);

    const v1 = await frames.publishedFrame(db, SYMBOL, '4h', CLOSE, 1);
    const v2 = await frames.publishedFrame(db, SYMBOL, '4h', CLOSE, 2);

    // v1 gives its own latest revision, unshadowed by the existence of v2.
    expect(v1?.frameVersion).toBe(1);
    expect(v1?.revision).toBe(2);
    expect(v1?.keys['atr.4h.14']).toEqual({ ok: true, value: 10 });

    expect(v2?.frameVersion).toBe(2);
    expect(v2?.revision).toBe(1);
    expect(v2?.keys['atr.4h.14']).toEqual({ ok: false, why: 'insufficient_history' });
  });

  it('is the mechanism that stops a cross-version comparison being assembled at all', async () => {
    // The scenario in one place. A v2 pass re-checking this close asks for the v2 frame and gets
    // null — so it WRITES rather than amends, and `decideAmendment` is never handed the v1 frame
    // whose `atr.4h.14` holds a value.
    //
    // Had the read stayed version-blind it would have returned the v1 frame, and the comparison
    // value -> insufficient_history would have been filed as a data defect. It is not one: the
    // definition changed, and v2 correctly needs 71 four-hourly bars. Those rows would bury every
    // real conflict under every definition change we ever make — the IB-048 failure again, which
    // cost 954 false conflicts in a single window.
    await put(1, 1, VALUE);

    expect(await frames.publishedFrame(db, SYMBOL, '4h', CLOSE, 2)).toBeNull();
    expect(await frames.publishedFrame(db, SYMBOL, '4h', CLOSE, 1)).not.toBeNull();
  });

  it('records a conflict against the version BOTH sides came from', async () => {
    await put(1, 1, VALUE);
    await frames.recordConflicts(
      db,
      { symbol: SYMBOL, tf: '4h', closeTimeMs: CLOSE, revision: 1, frameVersion: 1 },
      [{
        key: 'atr.4h.14' as const,
        published: { ok: true as const, value: 10 },
        recomputed: { ok: true as const, value: 11 },
      }],
    );

    const rows = await db.query<{ frame_version: number; feature_key: string }>(
      'select frame_version, feature_key from feature_value_conflicts');
    expect(rows).toEqual([{ frame_version: 1, feature_key: 'atr.4h.14' }]);
  });

  it('admits the same key as a conflict under BOTH versions — they are different observations', async () => {
    // Before 017 the second of these collided on the conflicts primary key, so a genuine v2
    // defect on a key that had also been defective under v1 was silently dropped.
    await put(1, 1, VALUE);
    await put(2, 1, REFUSED);
    const at = { symbol: SYMBOL, tf: '4h' as const, closeTimeMs: CLOSE, revision: 1 };
    const conflict = [{
      key: 'atr.4h.14' as const,
      published: { ok: true as const, value: 10 },
      recomputed: { ok: true as const, value: 11 },
    }];

    await frames.recordConflicts(db, { ...at, frameVersion: 1 }, conflict);
    await expect(frames.recordConflicts(db, { ...at, frameVersion: 2 }, conflict)).resolves.toBeUndefined();

    const rows = await db.query<{ frame_version: number }>(
      'select frame_version from feature_value_conflicts order by frame_version');
    expect(rows.map((r) => r.frame_version)).toEqual([1, 2]);
  });

  it('frameAtRevision will not hand back the other version at the same revision number', async () => {
    await put(1, 1, VALUE);
    await put(2, 1, REFUSED);

    // The pin ambiguity in one assertion: revision 1 exists under both versions, and before
    // IB-053 this call took only a revision and returned an arbitrary one of the two while still
    // looking exact. An audit row whose pin is ambiguous is worse than one with no pin.
    const pinnedV1 = await frames.frameAtRevision(db, SYMBOL, '4h', CLOSE, 1, 1);
    const pinnedV2 = await frames.frameAtRevision(db, SYMBOL, '4h', CLOSE, 1, 2);

    expect(pinnedV1?.keys['atr.4h.14']).toEqual({ ok: true, value: 10 });
    expect(pinnedV2?.keys['atr.4h.14']).toEqual({ ok: false, why: 'insufficient_history' });
    expect(await frames.frameAtRevision(db, SYMBOL, '4h', CLOSE, 1, 3)).toBeNull();
  });
});

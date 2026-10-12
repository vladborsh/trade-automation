import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { WEB_FRAME_VERSION, featureSpecFingerprint } from '@trade-automation/contracts';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import {
  FrameVersionMismatchError, assertFrameVersionFingerprint,
} from '../../src/features/frame-version-guard';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-015 migration 011 against a real Postgres. IB-BUG-005's rule: a spec that fakes the database
 * cannot see a schema drift, and the guard's unit spec deliberately fakes it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('feature-frames.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const CLOSE = Date.UTC(2026, 9, 12, 12, 0, 0);

maybeDescribe('IB-015 feature frames against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_frames', DATABASE_URL as string);
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

  const insertFrame = async (closeMs: number, complete = true, reason: string[] = [], revision = 1) =>
    db.query(
      `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis, complete, incomplete_reason, revision)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      ['BTCUSDT', '15m', new Date(closeMs), WEB_FRAME_VERSION,
        JSON.stringify({ 'oi.d24h_pct': { ok: true, value: 1.5 } }),
        JSON.stringify({ venues: ['bybit'], coverage: 'not_recorded', coveredHours: null }),
        complete, reason, revision],
    );

  it('creates the partitioned table the migration describes', async () => {
    const [row] = await db.query<{ partkey: string }>(
      `select pg_get_partkeydef('feature_frames'::regclass) as partkey`,
    );
    expect(row?.partkey).toContain('close_time');
  });

  it('REJECTS a tf outside 15m and 4h rather than storing an unknown frame', async () => {
    // Its own bar: these tests share a database and a collision would look like a schema fault.
    await expect(db.query(
      `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis, complete)
       values ('BTCUSDT','1h',$1,1,'{}','{}',true)`, [new Date(CLOSE - 3_600_000)],
    )).rejects.toThrow(/tf_check|check constraint/i);
  });

  it('APPENDS a revision rather than overwriting, so the armed-on answer survives', async () => {
    // "What did the frame at 12:00 actually say when something armed on it?" has to stay
    // answerable for ever — an in-place update destroys it the moment it amends.
    await insertFrame(CLOSE, false, ['candles_agg 15m@12:00 bars 14 of 15'], 1);
    await insertFrame(CLOSE, true, [], 2);
    const rows = await db.query<{ revision: number; complete: boolean }>(
      `select revision, complete from feature_frames
        where symbol='BTCUSDT' and tf='15m' and close_time=$1 order by revision`,
      [new Date(CLOSE)],
    );
    expect(rows.map((r) => r.revision)).toEqual([1, 2]);
    expect(rows[0].complete).toBe(false); // revision 1 still says what it said
    expect(rows[1].complete).toBe(true);
  });

  it('REFUSES a duplicate revision for one bar, so an amendment cannot be written twice', async () => {
    await insertFrame(CLOSE + 1_800_000, true, [], 1);
    await expect(insertFrame(CLOSE + 1_800_000, true, [], 1)).rejects.toThrow(/duplicate key/i);
  });

  it('REFUSES a row whose month has no partition, rather than parking it somewhere wrong', async () => {
    // No DEFAULT partition, by design (IB-004). The same property IB-041's restore depends on.
    await expect(insertFrame(Date.UTC(2031, 0, 1))).rejects.toThrow(/partition/i);
  });

  it('defaults incomplete_reason and amended_keys to empty rather than null', async () => {
    await insertFrame(CLOSE + 900_000);
    const [row] = await db.query<{ incomplete_reason: string[]; amended_keys: string[]; amended_at: Date | null }>(
      `select incomplete_reason, amended_keys, amended_at from feature_frames where close_time = $1`,
      [new Date(CLOSE + 900_000)],
    );
    expect(row?.incomplete_reason).toEqual([]);
    expect(row?.amended_keys).toEqual([]);
    expect(row?.amended_at).toBeNull(); // revision 1 amended nothing
  });

  it('records a value conflict without touching the published frame', async () => {
    await db.query(
      `insert into feature_value_conflicts (symbol, tf, close_time, revision, feature_key, published, recomputed)
       values ('BTCUSDT','15m',$1,1,'cvd.perp.4h','{"ok":true,"value":100}','{"ok":true,"value":999}')`,
      [new Date(CLOSE)],
    );
    const [row] = await db.query<{ n: string }>(`select count(*) as n from feature_value_conflicts`);
    expect(Number(row?.n)).toBe(1);
  });

  describe('the version guard, against the real table', () => {
    it('records the fingerprint on the first write and passes thereafter', async () => {
      await assertFrameVersionFingerprint(db);
      await assertFrameVersionFingerprint(db); // second write, same build
      const [row] = await db.query<{ frame_version: number; spec_fingerprint: string }>(
        `select frame_version, spec_fingerprint from feature_frame_versions`,
      );
      expect(row?.frame_version).toBe(WEB_FRAME_VERSION);
      expect(row?.spec_fingerprint).toBe(featureSpecFingerprint());
    });

    it('FAILS HARD when a later build changes the spec without bumping the version', async () => {
      // The case the stored row exists for: the repository's own spec would have been updated in
      // the same commit, so only the database can notice.
      await assertFrameVersionFingerprint(db);
      await expect(assertFrameVersionFingerprint(db, WEB_FRAME_VERSION, 'deadbeef'))
        .rejects.toThrow(FrameVersionMismatchError);
    });

    it('lets a BUMPED version proceed, which is the fix the error names', async () => {
      await assertFrameVersionFingerprint(db);
      await expect(assertFrameVersionFingerprint(db, WEB_FRAME_VERSION + 1, 'deadbeef'))
        .resolves.toBeUndefined();
      const rows = await db.query<{ frame_version: number }>(
        `select frame_version from feature_frame_versions order by frame_version`,
      );
      expect(rows.map((r) => r.frame_version)).toEqual([WEB_FRAME_VERSION, WEB_FRAME_VERSION + 1]);
    });
  });
});

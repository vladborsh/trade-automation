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

  const insertFrame = async (closeMs: number, complete = true, reason: string[] = []) =>
    db.query(
      `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis, complete, incomplete_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (symbol, tf, close_time) do update set keys = excluded.keys, complete = excluded.complete`,
      ['BTCUSDT', '15m', new Date(closeMs), WEB_FRAME_VERSION,
        JSON.stringify({ 'oi.d24h_pct': { ok: true, value: 1.5 } }),
        JSON.stringify({ venues: ['bybit'], coverage: 'not_recorded', coveredHours: null }),
        complete, reason],
    );

  it('creates the partitioned table the migration describes', async () => {
    const [row] = await db.query<{ partkey: string }>(
      `select pg_get_partkeydef('feature_frames'::regclass) as partkey`,
    );
    expect(row?.partkey).toContain('close_time');
  });

  it('REJECTS a tf outside 15m and 4h rather than storing an unknown frame', async () => {
    await expect(insertFrame(CLOSE).then(() => db.query(
      `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis, complete)
       values ('BTCUSDT','1h',$1,1,'{}','{}',true)`, [new Date(CLOSE)],
    ))).rejects.toThrow();
  });

  it('is idempotent on (symbol, tf, close_time), so a recompute replaces that bar\'s decision', async () => {
    await insertFrame(CLOSE);
    await insertFrame(CLOSE, false, ['candles_agg 15m@12:00 bars 14 of 15']);
    const rows = await db.query<{ complete: boolean; incomplete_reason: string[] }>(
      `select complete, incomplete_reason from feature_frames where symbol='BTCUSDT' and tf='15m' and close_time=$1`,
      [new Date(CLOSE)],
    );
    expect(rows).toHaveLength(1); // one bar, one decision — not two rows
    expect(rows[0].complete).toBe(false);
  });

  it('REFUSES a row whose month has no partition, rather than parking it somewhere wrong', async () => {
    // No DEFAULT partition, by design (IB-004). The same property IB-041's restore depends on.
    await expect(insertFrame(Date.UTC(2031, 0, 1))).rejects.toThrow(/partition/i);
  });

  it('defaults incomplete_reason to empty rather than null, so a reader never branches on null', async () => {
    await insertFrame(CLOSE + 900_000);
    const [row] = await db.query<{ incomplete_reason: string[] }>(
      `select incomplete_reason from feature_frames where close_time = $1`, [new Date(CLOSE + 900_000)],
    );
    expect(row?.incomplete_reason).toEqual([]);
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

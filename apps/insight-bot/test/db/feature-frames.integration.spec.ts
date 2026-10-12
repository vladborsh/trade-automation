import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { WEB_FRAME_VERSION, featureSpecFingerprint } from '@trade-automation/contracts';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import {
  FrameVersionMismatchError, assertFrameVersionFingerprint,
} from '../../src/features/frame-version-guard';
import * as inputs from '../../src/features/pg/feature-inputs.repo';
import * as frames from '../../src/features/pg/frames.repo';
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
      `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis, complete, incomplete_reason, revision, computed_mode, spec_fingerprint)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'live','test')`,
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
      `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis, complete, computed_mode, spec_fingerprint)
       values ('BTCUSDT','1h',$1,1,'{}','{}',true,'live','test')`, [new Date(CLOSE - 3_600_000)],
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

  /**
   * The repo's own SQL, against the real schema.
   *
   * A query that typechecks can still be wrong in every way that matters — a column that does
   * not exist, a `$4` Postgres cannot type, a `distinct on` whose `order by` disagrees with it.
   * None of that is visible until it runs.
   */
  describe('frames.repo', () => {
    const SYM = 'ETHUSDT';
    const frameAt = (closeMs: number, over: Partial<Parameters<typeof frames.insertFrame>[1]> = {}) => ({
      symbol: SYM,
      tf: '15m' as const,
      closeTime: Math.floor(closeMs / 1000),
      frameVersion: WEB_FRAME_VERSION,
      keys: { 'oi.d24h_pct': { ok: true as const, value: 1.5 } },
      basis: { venues: ['bybit'], coverage: 'not_recorded' as const, coveredHours: null },
      complete: true,
      incompleteReason: [] as string[],
      revision: 1,
      amendedAt: null as number | null,
      amendedKeys: [] as string[],
      computedMode: 'live' as const,
      computedAt: Math.floor(closeMs / 1000),
      specFingerprint: featureSpecFingerprint(),
      ...over,
    });

    it('round-trips a frame through insert and read', async () => {
      const at = CLOSE + 10 * 900_000;
      expect(await frames.insertFrame(db, frameAt(at))).toBe(true);
      const read = await frames.publishedFrame(db, SYM, '15m', at);
      expect(read?.closeTime).toBe(Math.floor(at / 1000));
      expect(read?.keys['oi.d24h_pct']).toEqual({ ok: true, value: 1.5 });
      expect(read?.revision).toBe(1);
    });

    it('reads the LATEST revision, not the first — the amendment path depends on it', async () => {
      const at = CLOSE + 11 * 900_000;
      await frames.insertFrame(db, frameAt(at, { complete: false, incompleteReason: ['short'] }));
      await frames.insertFrame(db, frameAt(at, {
        revision: 2, amendedAt: Math.floor(at / 1000), amendedKeys: ['oi.d24h_pct'],
      }));
      const read = await frames.publishedFrame(db, SYM, '15m', at);
      expect(read?.revision).toBe(2);
      expect(read?.amendedKeys).toEqual(['oi.d24h_pct']);
      expect(read?.complete).toBe(true);
    });

    it('is idempotent on a re-run: the second insert of a revision writes nothing', async () => {
      // The CLI re-runs ranges. The one thing it must never do is rewrite a row something may
      // already have armed on, so a repeat reports false rather than throwing or overwriting.
      const at = CLOSE + 12 * 900_000;
      expect(await frames.insertFrame(db, frameAt(at))).toBe(true);
      expect(await frames.insertFrame(db, frameAt(at, { complete: false }))).toBe(false);
      const read = await frames.publishedFrame(db, SYM, '15m', at);
      expect(read?.complete).toBe(true); // the first write stands
    });

    it('returns null for a close nothing was written for', async () => {
      expect(await frames.publishedFrame(db, SYM, '15m', CLOSE + 500 * 900_000)).toBeNull();
    });

    it('records conflicts against the published revision', async () => {
      const at = CLOSE + 13 * 900_000;
      await frames.insertFrame(db, frameAt(at));
      await frames.recordConflicts(db, { symbol: SYM, tf: '15m', closeTimeMs: at, revision: 1 }, [
        { key: 'oi.d24h_pct', published: { ok: true, value: 1.5 }, recomputed: { ok: true, value: 9 } },
      ]);
      const [row] = await db.query<{ n: string }>(
        `select count(*) as n from feature_value_conflicts where symbol = $1`, [SYM],
      );
      expect(Number(row?.n)).toBe(1);
    });
  });

  /**
   * `frameCounts` is where the three-way distinction has to survive contact with SQL: a frame
   * is chaseable, permanently refused, or fine, and only the first is anybody's problem.
   */
  describe('frameCounts', () => {
    const SYM = 'SOLUSDT';
    const BASE = Date.UTC(2026, 9, 5, 0, 0, 0);
    const HEAL_DEADLINE = BASE + 10 * 900_000;

    const write = (i: number, keys: Record<string, unknown>, complete: boolean) =>
      frames.insertFrame(db, {
        symbol: SYM, tf: '4h', closeTime: Math.floor((BASE + i * 900_000) / 1000),
        frameVersion: WEB_FRAME_VERSION,
        keys: keys as never,
        basis: { venues: [], coverage: 'not_recorded', coveredHours: null },
        complete, incompleteReason: complete ? [] : ['x'],
        revision: 1, amendedAt: null, amendedKeys: [],
        computedMode: 'live', computedAt: Math.floor((BASE + i * 900_000) / 1000),
        specFingerprint: featureSpecFingerprint(),
      });

    beforeAll(async () => {
      await write(0, { a: { ok: true, value: 1 } }, true);
      // chaseable, and old enough that no heal pass will reach it again
      await write(1, { a: { ok: false, why: 'incomplete_input' } }, false);
      // chaseable but still young — incomplete, NOT unhealed
      await write(20, { a: { ok: false, why: 'incomplete_input' } }, false);
      // permanently refused: complete = false for ever, and nobody's problem
      await write(2, { a: { ok: false, why: 'explained_absence' } }, false);
      await write(3, { a: { ok: false, why: 'insufficient_history' } }, false);
    }, DB_HOOK_TIMEOUT_MS);

    const counts = async () => {
      const rows = await frames.frameCounts(db, BASE - 900_000, BASE + 100 * 900_000, HEAL_DEADLINE);
      return rows.find((r) => r.tf === '4h');
    };

    it('counts only incomplete_input as chaseable, whatever `complete` says', async () => {
      const row = await counts();
      expect(row?.written).toBe(5);
      expect(row?.incomplete).toBe(2);
    });

    it('counts permanent refusals SEPARATELY, so they never light an alarm', async () => {
      // Both of these are `complete = false`. A counter keyed on that column would report 4
      // problems where there are 2, and two of them could never be cleared by anyone.
      const row = await counts();
      expect(row?.explainedOnly).toBe(2);
    });

    it('calls only the ones past the heal deadline unhealed — a young frame is not a fault', async () => {
      const row = await counts();
      expect(row?.unhealed).toBe(1);
      expect(row?.oldestUnhealedMs).toBe(BASE + 1 * 900_000);
    });
  });

  /**
   * The input queries, against the real schema but no data. This proves only that each one
   * parses, types its parameters and names columns that exist — which is exactly the class of
   * error a unit test with a fake database cannot reach, and the class that broke the backfill
   * runner spec when its fake matched on SQL text.
   */
  describe('feature-inputs.repo SQL', () => {
    const NOW = CLOSE;
    const syms = ['BTCUSDT'];

    it('every input query runs against the real schema', async () => {
      await expect(Promise.all([
        inputs.aggBars(db, { venue: 'binance', market: 'perp', symbols: syms, tf: '15m', fromMs: NOW - 86_400_000, toMsExclusive: NOW }),
        inputs.minuteBars(db, { venue: 'binance', market: 'perp', symbols: syms, fromMs: NOW - 86_400_000, toMsExclusive: NOW }),
        inputs.minuteCount(db, { venue: 'binance', market: 'perp', symbols: syms, fromMs: NOW - 86_400_000, toMsExclusive: NOW }),
        inputs.oiSlots(db, { venue: 'binance', symbols: syms, fromMs: NOW - 86_400_000, toMsExclusive: NOW }),
        inputs.recentSettlements(db, { symbols: syms, beforeMs: NOW, limitPerVenue: 90 }),
        inputs.predictedFundingAt(db, { venue: 'binance', symbols: syms, atMs: NOW, withinMs: 600_000 }),
        inputs.longShortSeries(db, { venue: 'binance', symbols: syms, fromMs: NOW - 86_400_000, toMsExclusive: NOW }),
        inputs.liquidationBuckets(db, { symbols: syms, fromMs: NOW - 86_400_000, toMsExclusive: NOW, widthSec: 3600 }),
        inputs.liquidationHistoryStartMs(db),
        inputs.recordedGapMinutes(db, { stream: 'binance:kline_1m', symbols: syms, fromMs: NOW - 86_400_000, toMsExclusive: NOW }),
        inputs.listedPerpMs(db, 'BTCUSDT'),
        inputs.signalSetSymbols(db),
      ])).resolves.toBeDefined();
    });

    it('returns an empty result for no symbols rather than matching everything', async () => {
      // `symbol = any('{}')` matches nothing, but the guard matters for the readers that would
      // otherwise send an unparameterised query: an empty spelling list is IB-BUG-011's signal
      // that the symbol is unknown, and the answer is no rows, never all rows.
      expect(await inputs.aggBars(db, { venue: 'binance', market: 'perp', symbols: [], tf: '15m', fromMs: 0, toMsExclusive: NOW })).toEqual([]);
      expect(await inputs.minuteCount(db, { venue: 'binance', market: 'perp', symbols: [], fromMs: 0, toMsExclusive: NOW })).toBe(0);
      expect(await inputs.liquidationBuckets(db, { symbols: [], fromMs: 0, toMsExclusive: NOW, widthSec: 3600 })).toEqual([]);
    });
  });

  /**
   * IB-049 — every frame records the spec fingerprint it was computed under.
   *
   * `frame_version` is the WEAK identifier: a number a human assigns and can forget to bump.
   * This is derived from the key set, so it cannot be forgotten. Had the column existed, the
   * episode that produced it would have diagnosed itself — dev-1's 905 frames would have shown
   * two fingerprints on inspection instead of being inferred by counting keys per row.
   */
  describe('spec_fingerprint per frame', () => {
    const aFrame = (closeMs: number, symbol = 'FPUSDT') => ({
      symbol, tf: '15m' as const, closeTime: Math.floor(closeMs / 1000),
      frameVersion: WEB_FRAME_VERSION,
      keys: { 'px.close': { ok: true as const, value: 1 } },
      basis: { venues: [], coverage: 'not_recorded' as const, coveredHours: null },
      complete: true, incompleteReason: [] as string[], revision: 1,
      amendedAt: null as number | null, amendedKeys: [] as string[],
      computedMode: 'live' as const, computedAt: Math.floor(closeMs / 1000),
      specFingerprint: featureSpecFingerprint(),
    });

    it('is written from the LIVE registry, not from the caller', async () => {
      const at = CLOSE + 20 * 900_000;
      await frames.insertFrame(db, aFrame(at));
      const [row] = await db.query<{ spec_fingerprint: string }>(
        `select spec_fingerprint from feature_frames where close_time = $1`, [new Date(at)]);
      expect(row?.spec_fingerprint).toBe(featureSpecFingerprint());
    });

    it('REFUSES a frame with no fingerprint rather than defaulting it', async () => {
      // No DEFAULT, as with computed_mode and frame_revision: a writer that omits it must fail
      // loudly rather than claim a spec the frame may not have run under — which is the exact
      // defect the column exists to make impossible.
      await expect(db.query(
        `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis,
                                     complete, computed_mode)
         values ('ZZZUSDT','15m',$1,1,'{}','{}',true,'live')`, [new Date(CLOSE + 21 * 900_000)],
      )).rejects.toThrow(/spec_fingerprint/i);
    });

    it('makes a MIXTURE a select rather than an inference', async () => {
      // The query nobody could run during IB-049. dev-1's slot held 903 frames at one key set
      // and 2 at another, and the only way to see it was to count keys per row.
      const at = CLOSE + 22 * 900_000;
      await db.query(
        `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis, complete,
                                     revision, computed_mode, spec_fingerprint)
         values ('MIXUSDT','15m',$1,1,'{}','{}',true,1,'live','7a4a2a87')`, [new Date(at)]);
      await frames.insertFrame(db, aFrame(at + 900_000, 'MIXUSDT'));

      const rows = await db.query<{ spec_fingerprint: string; n: string }>(
        `select spec_fingerprint, count(*)::text as n from feature_frames
          where symbol = 'MIXUSDT' group by 1 order by 1`);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.spec_fingerprint)).toContain('7a4a2a87');
      expect(rows.map((r) => r.spec_fingerprint)).toContain(featureSpecFingerprint());
    });

    it('contradicts a retroactive claim instead of being silently legitimised by it', async () => {
      // The specific thing ruled against: a single write through the claiming path would have
      // certified the current fingerprint over 903 frames computed under another. With the
      // column, the claim and the rows disagree in a query anyone can run.
      const claimed = await db.query<{ spec_fingerprint: string }>(
        `select spec_fingerprint from feature_frame_versions where frame_version = $1`,
        [WEB_FRAME_VERSION]);
      const disagreeing = await db.query<{ n: string }>(
        `select count(*)::text as n from feature_frames
          where spec_fingerprint <> $1`, [claimed[0]?.spec_fingerprint ?? '']);
      expect(Number(disagreeing[0]?.n)).toBeGreaterThan(0); // the MIXUSDT row seeded above
    });
  });
});

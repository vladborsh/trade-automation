import { randomUUID } from 'crypto';
import { WEB_FRAME_VERSION, featureSpecFingerprint } from '@trade-automation/contracts';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { FeaturePassService } from '../../src/features/feature-pass.service';
import { publishedFrame } from '../../src/features/pg/frames.repo';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-015 §8.1 — the re-check path, end to end against a real database.
 *
 * The decision itself is pure and spec'd in `frame-amendment.spec.ts`. What CANNOT be checked
 * without a database is the loop around it: that a heal between two looks really does produce a
 * second revision, that the first revision survives it, and — the Tech Lead's condition of
 * 2026-10-12 — that a re-check which changes nothing writes **nothing at all**, proven by
 * running it twice rather than by asserting the intent.
 *
 * Without that last rule "append-only" quietly becomes "grows for ever": a duplicate revision
 * every thirty seconds satisfies the letter of it and destroys the property.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('feature-pass.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;
const CLOSE = Date.UTC(2026, 9, 12, 12, 0, 0);
const SYMBOL = 'BTCUSDT';
const VENUE_SPELLING = 'BTCUSDT';

maybeDescribe('IB-015 the feature pass against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let service: FeaturePassService;

  /** 96 complete 15m buckets ending at the close — enough for the px.* and structure keys. */
  const seedAgg = async (completeCount: number) => {
    await db.query(`delete from candles_agg`);
    for (let i = 96; i >= 1; i--) {
      const openTime = new Date(CLOSE - i * 15 * MIN);
      const price = 80_000 + (96 - i) * 10;
      // The LAST bucket is the one made incomplete, because it is the closing bucket §8.1 is about.
      const complete = i > 96 - completeCount;
      await db.query(
        `insert into candles_agg (venue, market, symbol, tf, open_time, open, high, low, close,
                                  volume, bars, complete)
         values ('binance','perp',$1,'15m',$2,$3,$4,$5,$6,1,$7,$8)`,
        [VENUE_SPELLING, openTime, price, price + 5, price - 5, price, complete ? 15 : 9, complete],
      );
    }
  };

  /**
   * 24 h of 1m bars for both markets, so the CVD group is not short.
   *
   * Seeded because the first version of this spec left it out, and the last test then failed:
   * the symbol was still "awaiting a heal" — correctly — because `candles1m:perp` was short the
   * whole time. The code was right and the expectation was wrong, which is the good direction
   * for that to happen in.
   */
  const seedMinutes = async () => {
    for (const market of ['perp', 'spot']) {
      await db.query(
        `insert into candles_1m (venue, market, symbol, open_time, open, high, low, close,
                                 volume, taker_buy_volume, source)
         select 'binance', $1, $2, g, 80000, 80010, 79990, 80000, 1, 0.6, 'ws'
           from generate_series($3::timestamptz, $4::timestamptz, interval '1 minute') g`,
        [market, VENUE_SPELLING, new Date(CLOSE - 24 * 60 * MIN), new Date(CLOSE - MIN)],
      );
    }
  };

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_pass', DATABASE_URL as string);
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
      .ensureRange(new Date(CLOSE - 400 * 86_400_000), new Date(CLOSE + 40 * 86_400_000));
    await db.query(
      `insert into symbols (id, base, quote, binance_perp, listed_perp, in_signal_set, active)
       values ($1,'BTC','USDT',$2,'2020-01-01',true,true)`,
      [SYMBOL, VENUE_SPELLING],
    );
    service = new FeaturePassService(db);
    await seedMinutes();
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  beforeEach(async () => {
    await db.query(`delete from feature_frames`);
    await db.query(`delete from feature_value_conflicts`);
  });

  it('writes a frame at the grace look, refusing the keys the short bucket poisoned', async () => {
    await seedAgg(95); // the closing bucket is short
    const outcome = await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');

    expect(outcome.action).toBe('written');
    expect(outcome.frame.revision).toBe(1);
    expect(outcome.frame.complete).toBe(false);
    // px.* read agg:15m, so they refuse — and they refuse with the CHASEABLE reason, because a
    // bucket short of its bars is something a heal can still deliver.
    expect(outcome.frame.keys['px.ret_4h']).toEqual({ ok: false, why: 'incomplete_input' });
    expect(outcome.frame.incompleteReason.join(' ')).toContain('candles_agg 15m');
  });

  it('writes the frame even when it refuses — a missing frame is not a refusal', async () => {
    await seedAgg(95);
    await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');
    const stored = await publishedFrame(db, SYMBOL, '15m', CLOSE);
    expect(stored).not.toBeNull();
  });

  it('AMENDS to revision 2 when the bucket heals between two looks', async () => {
    await seedAgg(95);
    await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');

    await seedAgg(96); // the heal pass completed the bucket
    const second = await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 30_000, 'live');

    expect(second.action).toBe('amended');
    expect(second.frame.revision).toBe(2);
    expect(second.frame.amendedKeys).toContain('px.ret_4h');
    expect(second.frame.amendedAt).toBe(Math.floor((CLOSE + 30_000) / 1000));
    expect((second.frame.keys['px.ret_4h'] as { ok: true }).ok).toBe(true);
  });

  it('keeps revision 1 saying what it said, so an armed-on answer survives', async () => {
    await seedAgg(95);
    await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');
    await seedAgg(96);
    await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 30_000, 'live');

    const rows = await db.query<{ revision: number; complete: boolean }>(
      `select revision, complete from feature_frames where close_time = $1 order by revision`,
      [new Date(CLOSE)],
    );
    expect(rows.map((r) => r.revision)).toEqual([1, 2]);
    expect(rows[0]?.complete).toBe(false); // the frame something may have armed on, untouched
  });

  it('WRITES NOTHING when a re-check changes nothing, proven by running twice', async () => {
    // The Tech Lead's condition. Asserted on the ROW COUNT rather than on the returned action,
    // because the thing that matters is what reached the table.
    await seedAgg(96);
    await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');
    const after1 = await db.query<{ n: string }>(`select count(*) as n from feature_frames`);

    const second = await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 30_000, 'live');
    const after2 = await db.query<{ n: string }>(`select count(*) as n from feature_frames`);
    const third = await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 60_000, 'live');
    const after3 = await db.query<{ n: string }>(`select count(*) as n from feature_frames`);

    expect(second.action).toBe('unchanged');
    expect(third.action).toBe('unchanged');
    expect(Number(after2[0]?.n)).toBe(Number(after1[0]?.n));
    expect(Number(after3[0]?.n)).toBe(Number(after1[0]?.n));
  });

  it('records a conflict and KEEPS the published value when an input moved underneath', async () => {
    // Rule 2: a recompute that would change an already-published value is a data defect, not a
    // correction. Something may already have armed on the published answer.
    await seedAgg(96);
    const first = await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');
    const publishedRet = first.frame.keys['px.ret_4h'];

    // Move an input under the frame: rewrite the closing bucket at a different price.
    await db.query(
      `update candles_agg set close = close * 2, high = high * 2 where open_time = $1`,
      [new Date(CLOSE - 15 * MIN)],
    );
    const second = await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 30_000, 'live');

    expect(second.conflicts).toBeGreaterThan(0);
    expect(second.action).toBe('unchanged');
    // the published value STANDS
    const stored = await publishedFrame(db, SYMBOL, '15m', CLOSE);
    expect(stored?.keys['px.ret_4h']).toEqual(publishedRet);
    expect(stored?.revision).toBe(1);

    const conflicts = await db.query<{ feature_key: string }>(
      `select feature_key from feature_value_conflicts`,
    );
    expect(conflicts.map((c) => c.feature_key)).toContain('px.ret_4h');
  });

  it('a re-check visits only the frames still awaiting a heal', async () => {
    await seedAgg(95);
    await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');
    const recheck = await service.runPass('15m', CLOSE, CLOSE + 30_000, 'live', 'awaiting-heal');
    expect(recheck.outcomes.map((o) => o.symbol)).toEqual([SYMBOL]);

    // Once it heals and the frame carries nothing chaseable, the next re-check skips it rather
    // than re-gathering every symbol three times per close to learn that nothing changed.
    await seedAgg(96);
    await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 30_000, 'live');
    // Nothing chaseable is left on the latest revision, which is what makes the skip correct
    // rather than merely convenient — and is the assertion that failed until a stale
    // `incomplete_input` stopped surviving the heal.
    const stillChaseable = await db.query<{ key: string }>(
      `select kv.key from feature_frames, jsonb_each(keys) kv
        where close_time = $1 and revision = (select max(revision) from feature_frames where close_time = $1)
          and kv.value->>'why' = 'incomplete_input'`, [new Date(CLOSE)],
    );
    expect(stillChaseable.map((r) => r.key)).toEqual([]);
    const after = await service.runPass('15m', CLOSE, CLOSE + 60_000, 'live', 'awaiting-heal');
    expect(after.outcomes).toEqual([]);
  });

  /**
   * IB-015's provenance column (Tech Lead, 2026-10-12).
   *
   * The case it exists for, reproduced end to end: a live pass refuses `incomplete_input` on a
   * short bucket; derive heals it; a BACKFILL run over the same close computes a value. The
   * backfilled answer is better informed than the one that actually existed at that close, in a
   * direction that correlates with the data. Without the column, nothing downstream could tell
   * the two apart — and anything learning from frames would train on information that did not
   * exist at the moment it claims to model.
   */
  describe('computed_mode', () => {
    it('marks a live pass live and a backfill run backfill', async () => {
      await seedAgg(96);
      const live = await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');
      expect(live.frame.computedMode).toBe('live');
      expect(live.frame.computedAt).toBe(Math.floor((CLOSE + 15_000) / 1000));

      await db.query(`delete from feature_frames`);
      const back = await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 86_400_000, 'backfill');
      expect(back.frame.computedMode).toBe('backfill');
    });

    it('records the LOOKAHEAD case: the same close, refused live and computed by backfill', async () => {
      // The live pass sees a short closing bucket.
      await seedAgg(95);
      const live = await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');
      expect(live.frame.keys['px.ret_4h']).toEqual({ ok: false, why: 'incomplete_input' });

      // Derive heals it hours later; a backfill run then computes a value for the SAME bar.
      await seedAgg(96);
      const back = await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 86_400_000, 'backfill');
      expect(back.action).toBe('amended');
      expect((back.frame.keys['px.ret_4h'] as { ok: true }).ok).toBe(true);

      // The two revisions are distinguishable, which is the entire point.
      const rows = await db.query<{ revision: number; computed_mode: string }>(
        `select revision, computed_mode from feature_frames where close_time = $1 order by revision`,
        [new Date(CLOSE)],
      );
      expect(rows).toEqual([
        { revision: 1, computed_mode: 'live' },
        { revision: 2, computed_mode: 'backfill' },
      ]);
    });

    it('keeps the live revision readable, so "what was knowable at the close" survives', async () => {
      await seedAgg(95);
      await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');
      await seedAgg(96);
      await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 86_400_000, 'backfill');

      const all = await db.query<{ revision: number }>(
        `select revision from feature_frames where close_time = $1 and computed_mode = 'live'`,
        [new Date(CLOSE)],
      );
      expect(all.map((r) => r.revision)).toEqual([1]);
    });

    it('REFUSES a row with no computed_mode rather than defaulting it to live', async () => {
      // No DEFAULT on the column, deliberately: a new writer that forgets must fail loudly,
      // not silently inherit the mode that claims less information.
      await expect(db.query(
        `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis, complete, spec_fingerprint)
         values ($1,'15m',$2,1,'{}','{}',true,'test')`, [SYMBOL, new Date(CLOSE + 50 * 900_000)],
      )).rejects.toThrow(/computed_mode/i);
    });

    it('REFUSES a mode outside live and backfill', async () => {
      await expect(db.query(
        `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis, complete, computed_mode, spec_fingerprint)
         values ($1,'15m',$2,1,'{}','{}',true,'guessed','test')`, [SYMBOL, new Date(CLOSE + 51 * 900_000)],
      )).rejects.toThrow(/computed_mode|check constraint/i);
    });
  });

  /**
   * IB-049 — the version claim cannot be bypassed.
   *
   * The defect these exist for: `assertFrameVersionFingerprint` lived in `runPass`, and
   * `features.cli --symbol` calls `runClose` directly, so the bulk-backfill path wrote frames
   * and claimed nothing. `insight_dev1` reached 905 frames with an empty
   * `feature_frame_versions` — and with no claim row the guard is silent by construction,
   * because `checkFingerprint` returns early when there is nothing to compare against.
   *
   * **Every spec for the guard passed throughout**, because they all called the guarded path.
   * These call the one that skipped it.
   */
  describe('the version claim is in the write primitive', () => {
    it('runClose alone — the --symbol path — claims the version', async () => {
      await db.query(`delete from feature_frame_versions`);
      await seedAgg(96);
      await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live');

      const rows = await db.query<{ frame_version: number; spec_fingerprint: string }>(
        `select frame_version, spec_fingerprint from feature_frame_versions`);
      expect(rows).toEqual([{ frame_version: WEB_FRAME_VERSION, spec_fingerprint: featureSpecFingerprint() }]);
    });

    it('a frame can never exist without a claim describing it', async () => {
      // The property the bypass broke, asserted directly rather than via the caller that
      // happens to be guarded today.
      await db.query(`delete from feature_frame_versions`);
      await seedAgg(96);
      await service.runClose(SYMBOL, '15m', CLOSE + 30 * MIN, CLOSE + 30 * MIN + 15_000, 'live');

      const [frames] = await db.query<{ n: string }>(`select count(*) as n from feature_frames`);
      const [claims] = await db.query<{ n: string }>(`select count(*) as n from feature_frame_versions`);
      expect(Number(frames?.n)).toBeGreaterThan(0);
      expect(Number(claims?.n)).toBe(1);
    });

    it('REFUSES the write when a claim exists under a different fingerprint', async () => {
      // The case the guard was built for, now reachable from the write rather than only from
      // the pass: a later build changed the key set without bumping the version.
      await db.query(`delete from feature_frame_versions`);
      await db.query(
        `insert into feature_frame_versions (frame_version, spec_fingerprint) values ($1, 'deadbeef')`,
        [WEB_FRAME_VERSION]);
      await seedAgg(96);
      await expect(service.runClose(SYMBOL, '15m', CLOSE + 60 * MIN, CLOSE + 60 * MIN + 15_000, 'live'))
        .rejects.toThrow(/spec changed under frame_version/);
    });

    it('and writes NO frame when it refuses', async () => {
      // A refusal that still wrote the row would be the worst of both.
      await db.query(`delete from feature_frame_versions`);
      await db.query(`delete from feature_frames`);
      await db.query(
        `insert into feature_frame_versions (frame_version, spec_fingerprint) values ($1, 'deadbeef')`,
        [WEB_FRAME_VERSION]);
      await seedAgg(96);
      await service.runClose(SYMBOL, '15m', CLOSE, CLOSE + 15_000, 'live').catch(() => undefined);
      const [row] = await db.query<{ n: string }>(`select count(*) as n from feature_frames`);
      expect(Number(row?.n)).toBe(0);
    });
  });
});

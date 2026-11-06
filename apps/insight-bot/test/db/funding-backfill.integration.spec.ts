import { randomUUID } from 'crypto';
import { Client } from 'pg';
import {
  HistoryFundingVenue, MemoryFundingJournal, fundingCrossCheck, fundingHistoryParams, fundingHistoryStore, replayEnd, replayFunding, type SettledPoint,
} from '../../src/alerts/funding/backfill/funding-history';
import { PgFundingAlertStore } from '../../src/alerts/funding/pg/funding-alerts.repo';
import { PgFundingBackfillReads } from '../../src/alerts/liquidations/pg/market-backfill-reads';
import { PgLiqBackfillReads } from '../../src/alerts/liquidations/pg/liq-backfill-reads';
import { measureBackfillPaths } from '../../src/alerts/oi-divergence/backfill/history-backfill';
import { PgOiAlertStore, type PathSubjects } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import type { Db } from '../../src/db/db.port';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { savepointDb } from '../../src/db/pg/savepoint-db';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-125 — the funding history run against real SQL (031's once-keys, 034's state table):
 * - the dry run: ONE outer transaction, the repository's per-check transactions as savepoints, rolled back to
 *   nothing; a savepoint's own throw rolls back only that savepoint;
 * - the write: `source='backfill'` rows with paths, never sent, `alert_funding_state` untouched (the run's state
 *   is in memory), the in-memory ×1 equal to the rows stored; a rerun writes 0;
 * - `pathsDue` subjects: `funding` and `liq` never take each other's paths (the 11-11 liq rerun would have
 *   measured the funding backlog under `market`); `market` and `all` take both;
 * - live rows at or before `--until` are found per type.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('funding-backfill.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 4, 1);
const COINS = [{ symbol: 'BTCUSDT', base: 'BTC' }];

/** A month of ordinary 8 h rates, then a 32 h extreme high episode, back to normal, a flip, 3 more days. */
function series(): SettledPoint[] {
  const base = [0.0001, 0.00005, 0.00015, 0.00008, 0.00012];
  const pts: SettledPoint[] = [];
  for (let i = 0; i <= 90; i++) pts.push({ time: (T0 - (90 - i) * 8 * H) / 1000, rate: base[i % 5] as number });
  [0.0008, 0.0008, 0.0008, 0.0008, 0.0001, 0.0001, -0.0002, -0.0002, -0.0002, 0.0001, 0.0001, 0.0001]
    .forEach((rate, i) => pts.push({ time: (T0 + (i + 1) * 8 * H) / 1000, rate }));
  return pts;
}

maybeDescribe('IB-125 the funding history run on real SQL', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  const s = new Map([['BTCUSDT', series()]]);
  const toMs = replayEnd(s, T0 + 30 * DAY);
  const run = (handle: Db, base = new PgFundingAlertStore(handle)) => replayFunding({
    store: fundingHistoryStore(base, { params: fundingHistoryParams(['BTCUSDT'], 1), coins: COINS }), venue: new HistoryFundingVenue(s), build: 'dev',
  }, T0, toMs);

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_fundbf', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: u.toString() });
    db = new PgDatabase(u.toString());
    await db.query(`update alert_type_settings set enabled = true where type = 'funding'`); // the run must ignore it
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('savepointDb: a savepoint that throws rolls back only itself; the outer transaction keeps the rest', async () => {
    await db.query('create table sp_probe (n int)');
    await db.transaction(async (tx) => {
      const sdb = savepointDb(tx);
      await sdb.transaction(async (h) => { await h.query('insert into sp_probe values (1)'); });
      await expect(sdb.transaction(async (h) => { await h.query('insert into sp_probe values (2)'); throw new Error('no'); })).rejects.toThrow('no');
      await sdb.query('insert into sp_probe values (3)');
    });
    expect((await db.query<{ n: number }>('select n from sp_probe order by n')).map((r) => r.n)).toEqual([1, 3]);
    await db.query('drop table sp_probe');
  });

  it('dry run: the per-check transactions are savepoints in ONE transaction, rolled back to nothing', async () => {
    let inside: Record<string, number> = {};
    await expect(db.transaction(async (tx) => {
      const t = await run(savepointDb(tx));
      expect(t).toMatchObject({ enters: 1, flips: 1, warnings: {} });
      inside = await new PgFundingBackfillReads(tx).backfillCounts();
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(inside).toMatchObject({ alerts_enter: 1, alerts_flip: 1 });
    expect(inside.controls_random).toBeGreaterThan(0);
    expect(await new PgFundingBackfillReads(db).backfillCounts()).toEqual({ paths: 0, paths_measured: 0 }); // no event or kind: no row
  }, 120_000);

  it('write: backfill rows with paths, never sent, no state rows; equal to the in-memory ×1; a rerun writes 0', async () => {
    const first = await run(db);
    expect(first).toMatchObject({ enters: 1, flips: 1, warnings: {} });
    const rows = await db.query<{ event: string; at: Date; source: string; fired_at: Date | null; recipients: number; late: boolean; tf: string; dedupe_key: string }>(
      `select event, at, source, fired_at, recipients, late, tf, dedupe_key from market_alerts where type = 'funding' order by at`);
    expect(rows.map((r) => [r.event, new Date(r.at).getTime(), r.source, r.fired_at, r.recipients, r.late, r.tf])).toEqual([
      ['enter', T0, 'backfill', null, 0, false, '1h'], ['flip', T0 + 48 * H, 'backfill', null, 0, false, '1h'],
    ]);
    expect(rows.map((r) => r.dedupe_key)).toEqual([`funding:BTCUSDT:high:${T0}`, `funding-flip:BTCUSDT:high:${T0}`]);
    expect(await db.query(`select 1 from alert_funding_state where source = 'backfill'`)).toEqual([]);

    const stored = await new PgFundingBackfillReads(db).backfillCounts();
    const mem = new MemoryFundingJournal();
    await run(db, mem as unknown as PgFundingAlertStore);
    expect(fundingCrossCheck(mem, stored)).toBeNull();
    expect(stored.paths).toBe(3 * (2 + mem.controls.length)); // 4h, 24h, 72h per subject

    expect(await run(db)).toMatchObject({ enters: 0, flips: 0, controls: 0 });
    expect(await new PgFundingBackfillReads(db).backfillCounts()).toEqual(stored);
  }, 180_000);

  it('pathsDue subjects: funding ↔ liq never cross; market and all take both; the funding run measures only its own', async () => {
    const liq = await db.query<{ id: string }>(
      `insert into market_alert_controls (type, kind, symbol, at, details, params, source, build, dedupe_key) values ('liq','random','BTCUSDT',$1,'{}','{}','backfill','dev','liq-ctl') returning id`, [new Date(T0)]);
    await db.query(`insert into oi_divergence_paths (market_control_id, win, symbol, t0, atr14) values ($1, '4h', 'BTCUSDT', $2, 0)`, [liq[0]?.id, new Date(T0)]);
    const store = new PgOiAlertStore(db);
    const now = (toMs + 4 * DAY) / 1000;
    const due = async (x: PathSubjects) => (await store.pathsDue('backfill', now, 100_000, 900, x)).length;
    const funding = (await new PgFundingBackfillReads(db).backfillCounts()).paths as number;
    expect(await due('funding')).toBe(funding);
    expect(await due('liq')).toBe(1);
    expect(await due('market')).toBe(funding + 1);
    expect(await due('all')).toBe(funding + 1);
    expect(await due('oi')).toBe(0);
    expect((await new PgLiqBackfillReads(db).pathsDueNow(toMs + 4 * DAY)).windows).toBe(1);
    expect((await new PgFundingBackfillReads(db).pathsDueNow(toMs + 4 * DAY)).windows).toBe(funding);

    const out = await measureBackfillPaths(
      { store, build: 'dev', klines5m: async (_s, from) => [{ time: from, open: 1, high: 2, low: 0.5, close: 1 }] },
      { take: async () => undefined }, () => toMs + 4 * DAY, 500, 'funding',
    );
    expect(out).toMatchObject({ measured: funding, failed: 0 });
    expect(await due('liq')).toBe(1); // the liquidation path untouched
    expect(await new PgFundingBackfillReads(db).unmeasuredPaths()).toEqual({ count: 0, lastCloses: null });
  }, 120_000);

  it('live rows at or before --until, per type', async () => {
    const reads = new PgFundingBackfillReads(db);
    const at = new Date(T0 + 40 * DAY);
    await db.query(`insert into market_alert_controls (type, kind, symbol, at, details, params, source, build, dedupe_key) values ('liq','random','BTCUSDT',$1,'{}','{}','live','dev','live-liq')`, [at]);
    expect(await reads.liveRowsUpTo(at.getTime())).toBe(0); // a live LIQ row is not a funding one
    await db.query(`insert into market_alert_controls (type, kind, symbol, at, details, params, source, build, dedupe_key) values ('funding','random','BTCUSDT',$1,'{}','{}','live','dev','live-f')`, [at]);
    expect(await reads.liveRowsUpTo(at.getTime() - 1)).toBe(0);
    expect(await reads.liveRowsUpTo(at.getTime())).toBe(1);
  });
});

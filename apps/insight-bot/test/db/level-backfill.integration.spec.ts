import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { LEVEL_DEFAULT_PARAMS, type LevelBar, type WebCandle } from '@trade-automation/contracts';
import {
  BAR_MS, DAY_MS, HistoryLevelVenue, MemoryLevelJournal, levelCrossCheck, levelHistoryParams, levelHistoryStore, replayLevels,
} from '../../src/alerts/levels/backfill/level-history';
import { PgLevelAlertStore } from '../../src/alerts/levels/pg/level-alerts.repo';
import { PgFundingBackfillReads, PgLevelBackfillReads } from '../../src/alerts/liquidations/pg/market-backfill-reads';
import { measureBackfillPaths } from '../../src/alerts/oi-divergence/backfill/history-backfill';
import { PgOiAlertStore, type PathSubjects } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import type { Db } from '../../src/db/db.port';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { savepointDb } from '../../src/db/pg/savepoint-db';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-127 — the level history run against real SQL (031's once-keys and paths, 035's state table):
 * - the dry run: ONE outer transaction, the repo's per-bar transactions as savepoints, rolled back to nothing;
 * - the write: `source='backfill'` rows with paths, never sent even with the type switched on, `alert_level_state`
 *   untouched (the run's P10 state is in memory), the in-memory replay with PDH/PDL on equal to the rows stored once
 *   PDH/PDL are dropped; a rerun writes 0;
 * - `pathsDue` subjects: `level` and `funding` never take each other's paths; the level run measures only its own;
 * - live rows before the first live bar are found per type.
 * Scenario as level-history.spec.ts: PWH 100 for the week of 11-09, a close at 101 on Tuesday 06:00, closes AT 100
 * until Wednesday 10:00, a close at 99.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('level-backfill.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const utc = (m: number, d: number, h = 0, min = 0) => Date.UTC(2026, m - 1, d, h, min);
const WEEK = utc(11, 9);
const ABOVE = utc(11, 10, 6);
const BELOW = utc(11, 11, 10);
const TO = utc(11, 12);
const COINS = [{ symbol: 'BTCUSDT', base: 'BTC' }];

function daily(): WebCandle[] {
  const out: WebCandle[] = [];
  for (let t = utc(8, 20); t < TO; t += DAY_MS) {
    const c: WebCandle = { time: t / 1000, open: 90, high: 95, low: 85, close: 90, volume: 1 };
    if (t === utc(11, 4)) Object.assign(c, { high: 100, low: 80 });
    if (t === utc(10, 15)) Object.assign(c, { high: 120, low: 60 });
    out.push(c);
  }
  return out;
}

function bars(): LevelBar[] {
  const out: LevelBar[] = [];
  for (let t = utc(10, 31, 23, 45); t < TO; t += BAR_MS) {
    const c = t === ABOVE ? 101 : t === BELOW ? 99 : t > ABOVE && t < BELOW ? 100 : 92;
    out.push({ openMs: t, open: 92, high: Math.max(92, c) + 0.3, low: Math.min(92, c) - 0.3, close: c });
  }
  return out;
}

maybeDescribe('IB-127 the level history run on real SQL', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  const venue = () => new HistoryLevelVenue(new Map([['BTCUSDT', bars()]]), new Map([['BTCUSDT', daily()]]));
  const run = (handle: Db, base: PgLevelAlertStore | MemoryLevelJournal = new PgLevelAlertStore(handle), params = LEVEL_DEFAULT_PARAMS) => replayLevels({
    store: levelHistoryStore(base, { params, coins: COINS }), venue: venue(), build: 'dev',
  }, WEEK, TO);

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_levelbf', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: u.toString() });
    db = new PgDatabase(u.toString());
    await db.query(`update alert_type_settings set enabled = true where type = 'level'`); // the run must ignore it
    await db.query(`update users set level_alerts = true`);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('dry run: the per-bar transactions are savepoints in ONE transaction, rolled back to nothing', async () => {
    let inside: Record<string, number> = {};
    await expect(db.transaction(async (tx) => {
      const t = await run(savepointDb(tx));
      expect(t).toMatchObject({ failed: 0, warnings: {} });
      inside = await new PgLevelBackfillReads(tx).backfillCounts();
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(inside).toMatchObject({ alerts_breakout_up: 1, alerts_crossunder: 1 });
    expect(inside.controls_random).toBeGreaterThan(0);
    expect(await new PgLevelBackfillReads(db).backfillCounts()).toEqual({ paths: 0, paths_measured: 0 });
  }, 120_000);

  it('write: backfill rows with paths, never sent, no state rows; equal to the in-memory replay without PDH/PDL; a rerun writes 0', async () => {
    const first = await run(db);
    expect(first).toMatchObject({ failed: 0, warnings: {} });
    const rows = await db.query<{ event: string; at: Date; source: string; fired_at: Date | null; recipients: number; late: boolean; tf: string; dedupe_key: string }>(
      `select event, at, source, fired_at, recipients, late, tf, dedupe_key from market_alerts where type = 'level' and muted_by is null order by at`);
    expect(rows.map((r) => [r.event, new Date(r.at).getTime(), r.source, r.fired_at, r.recipients, r.late, r.tf, r.dedupe_key])).toEqual([
      ['breakout_up', ABOVE, 'backfill', null, 0, false, '15m', `level:BTCUSDT:PWH:${WEEK}:breakout_up`],
      ['crossunder', BELOW, 'backfill', null, 0, false, '15m', `level:BTCUSDT:PWH:${WEEK}:crossunder`],
    ]);
    expect(await db.query(`select 1 from alert_level_state`)).toEqual([]);
    // IB-151: PDH/PDL (daily off by default) are written too, muted by `daily`, never sent
    const muted = await db.query<{ kind: string; muted_by: string; fired_at: Date | null }>(
      `select details ->> 'kind' as kind, muted_by, fired_at from market_alerts where type = 'level' and muted_by is not null`);
    expect(muted.length).toBeGreaterThan(0);
    expect(muted.every((m) => (m.kind === 'PDH' || m.kind === 'PDL') && m.muted_by === 'daily' && m.fired_at === null)).toBe(true);

    const stored = await new PgLevelBackfillReads(db).backfillCounts();
    const mem = new MemoryLevelJournal();
    await run(db, mem, levelHistoryParams(['BTCUSDT'], 1, true));
    expect(mem.alerts.some((a) => a.kind === 'PDH' || a.kind === 'PDL')).toBe(true);
    expect(levelCrossCheck(mem, stored)).toBeNull();
    const mutedRows = Object.entries(stored).filter(([k]) => k.startsWith('muted_')).reduce((n, [, v]) => n + v, 0);
    expect(mutedRows).toBe(muted.length);
    expect(stored.paths).toBe(3 * (2 + mutedRows + (stored.controls_touch ?? 0) + (stored.controls_random ?? 0))); // 4h, 24h, 72h per subject

    expect(await run(db)).toMatchObject({ alerts: 0, controls: 0 });
    expect(await new PgLevelBackfillReads(db).backfillCounts()).toEqual(stored);
  }, 180_000);

  it('pathsDue subjects: level ↔ funding never cross; the level run measures only its own', async () => {
    const f = await db.query<{ id: string }>(
      `insert into market_alert_controls (type, kind, symbol, at, details, params, source, build, dedupe_key) values ('funding','random','BTCUSDT',$1,'{}','{}','backfill','dev','f-ctl') returning id`, [new Date(WEEK)]);
    await db.query(`insert into oi_divergence_paths (market_control_id, win, symbol, t0, atr14) values ($1, '4h', 'BTCUSDT', $2, 0)`, [f[0]?.id, new Date(WEEK)]);
    const store = new PgOiAlertStore(db);
    const nowMs = TO + 4 * DAY_MS;
    const due = async (x: PathSubjects) => (await store.pathsDue('backfill', nowMs / 1000, 100_000, 900, x)).length;
    const level = (await new PgLevelBackfillReads(db).backfillCounts()).paths as number;
    expect(await due('level')).toBe(level);
    expect(await due('funding')).toBe(1);
    expect(await due('market')).toBe(level + 1);
    expect((await new PgLevelBackfillReads(db).pathsDueNow(nowMs)).windows).toBe(level);
    expect((await new PgFundingBackfillReads(db).pathsDueNow(nowMs)).windows).toBe(1);

    const out = await measureBackfillPaths(
      { store, build: 'dev', klines5m: async (_s, from) => [{ time: from, open: 1, high: 2, low: 0.5, close: 1 }] },
      { take: async () => undefined }, () => nowMs, 500, 'level',
    );
    expect(out).toMatchObject({ measured: level, failed: 0 });
    expect(await due('funding')).toBe(1);
    expect(await new PgLevelBackfillReads(db).unmeasuredPaths()).toEqual({ count: 0, lastCloses: null });
  }, 120_000);

  it('live rows before the first live bar, per type', async () => {
    const reads = new PgLevelBackfillReads(db);
    const at = new Date(TO);
    await db.query(`insert into market_alert_controls (type, kind, symbol, at, details, params, source, build, dedupe_key) values ('funding','random','BTCUSDT',$1,'{}','{}','live','dev','live-f')`, [at]);
    expect(await reads.liveRowsUpTo(at.getTime())).toBe(0); // a live FUNDING row is not a level one
    await db.query(`insert into market_alert_controls (type, kind, symbol, at, details, params, source, build, dedupe_key) values ('level','random','BTCUSDT',$1,'{}','{}','live','dev','live-l')`, [at]);
    expect(await reads.liveRowsUpTo(at.getTime() - 1)).toBe(0);
    expect(await reads.liveRowsUpTo(at.getTime())).toBe(1);
  });
});

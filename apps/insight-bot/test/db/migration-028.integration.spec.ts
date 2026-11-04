import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { OI_DIVERGENCE_DEFAULT_PARAMS } from '@trade-automation/contracts';
import { PgBackfillReads } from '../../src/alerts/oi-divergence/pg/backfill-reads';
import { PgOiAlertStore } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-116 — migration 028 on a database at 027 that already holds a journal row, a control and a near-miss:
 * they read `live`; `source` is NOT NULL with no default on all three; the once-keys include it (live and
 * backfill coexist, each once); the database refuses a backfill alert that claims it was sent or late; the
 * in-sample rule is in the column comment; R11's read and the live measurer never see backfill rows; undo
 * and re-apply.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-028.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const TABLES = ['oi_divergence_alerts', 'oi_divergence_controls', 'oi_divergence_near_misses'];
const T0 = new Date(Date.UTC(2026, 9, 10, 12));
const T1 = new Date(Date.UTC(2026, 9, 11, 12));
const SHA = 'b49cd48d4ab4';

maybeDescribe('IB-116 migration 028: source live | backfill', () => {
  let name: string;
  let url: string;
  let admin: Client;
  let db: PgDatabase;

  const fails = async (sql: string, params: unknown[] = []): Promise<string> => {
    try {
      await db.query(sql, params);
      return 'accepted';
    } catch (e) {
      return (e as Error).message;
    }
  };
  const ALERT_COLS = 'symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, params, confirmed_at, build';
  const alertSql = (extraCols: string, extraVals: string) =>
    `insert into oi_divergence_alerts (${ALERT_COLS}${extraCols}) values ('BTCUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 98, $2, 1050, '{}', $2, '${SHA}'${extraVals})`;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m028', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '027' });
    db = new PgDatabase(url);
    // what the box holds before 028: rows written by the live loop, with no source column yet
    await db.query(alertSql('', ''), [T0, T1]);
    await db.query(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build) values ('BTCUSDT', '1h', 'random', null, $1, null, '{}', $2)`, [T0, SHA]);
    await db.query(`insert into oi_divergence_near_misses (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, rule, miss, unit, params, confirmed_at, build)
      values ('BTCUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 98, $2, 1050, 'k', 1, 'bars', '{}', $2, $3)`, [T0, T1, SHA]);
    await runMigrations({ connectionString: url });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it.each(TABLES)('%s: the rows from before 028 read live; source is NOT NULL with NO default; the comment states the in-sample rule', async (table) => {
    expect(await db.query(`select distinct source from ${table}`, [])).toEqual([{ source: 'live' }]);
    const [col] = await db.query<{ is_nullable: string; column_default: string | null }>(
      `select is_nullable, column_default from information_schema.columns where table_name = $1 and column_name = 'source'`, [table]);
    expect(col).toEqual({ is_nullable: 'NO', column_default: null });
    const [c] = await db.query<{ comment: string | null }>(`select col_description($1::regclass, (select attnum from pg_attribute where attrelid = $1::regclass and attname = 'source')) as comment`, [table]);
    expect(c.comment).toMatch(/IN-SAMPLE/);
    expect(c.comment).toMatch(/separately/i);
  });

  it('V30: a write without a source is refused, and so is any other value', async () => {
    expect(await fails(alertSql('', ''), [T0, new Date(T1.getTime() + 3_600_000)])).toMatch(/null value in column "source"/);
    expect(await fails(alertSql(', source', ", 'history'"), [T0, new Date(T1.getTime() + 3_600_000)])).toMatch(/check constraint/);
    expect(await fails(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build) values ('ETHUSDT', '1h', 'random', null, $1, null, '{}', $2)`, [T1, SHA]))
      .toMatch(/null value in column "source"/);
    expect(await fails(`insert into oi_divergence_near_misses (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, rule, miss, unit, params, confirmed_at, build)
      values ('ETHUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 98, $2, 1050, 'k', 1, 'bars', '{}', $2, $3)`, [T0, T1, SHA])).toMatch(/null value in column "source"/);
  });

  it('V30: the same alert, control and near-miss exist once as live AND once as backfill; a second backfill is refused', async () => {
    expect(await fails(alertSql(', source', ", 'backfill'"), [T0, T1])).toBe('accepted');
    expect(await fails(alertSql(', source', ", 'backfill'"), [T0, T1])).toMatch(/oi_divergence_alerts_once/);
    expect(await fails(alertSql(', source', ", 'live'"), [T0, T1])).toMatch(/oi_divergence_alerts_once/);
    const control = (src: string) => fails(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build, source) values ('BTCUSDT', '1h', 'random', null, $1, null, '{}', $2, $3)`, [T0, SHA, src]);
    expect(await control('backfill')).toBe('accepted');
    expect(await control('backfill')).toMatch(/oi_divergence_controls_once/); // nulls not distinct still holds
    const nm = (src: string) => fails(`insert into oi_divergence_near_misses (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, rule, miss, unit, params, confirmed_at, build, source)
      values ('BTCUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 98, $2, 1050, 'w', 2, 'bars', '{}', $2, $3, $4)`, [T0, T1, SHA, src]);
    expect(await nm('backfill')).toBe('accepted');
    expect(await nm('backfill')).toMatch(/oi_divergence_near_misses_once/);
    expect(await nm('live')).toMatch(/oi_divergence_near_misses_once/);
  });

  it('V30: the database refuses a backfill alert that was sent, had recipients, or was late — and refuses marking one sent later', async () => {
    const b = (h: number) => new Date(T1.getTime() + h * 3_600_000);
    expect(await fails(alertSql(', source, fired_at', ", 'backfill', now()"), [T0, b(10)])).toMatch(/oi_divergence_alerts_backfill_unsent/);
    expect(await fails(alertSql(', source, recipients', ", 'backfill', 1"), [T0, b(11)])).toMatch(/oi_divergence_alerts_backfill_unsent/);
    expect(await fails(alertSql(', source, late', ", 'backfill', true"), [T0, b(12)])).toMatch(/oi_divergence_alerts_backfill_unsent/);
    expect(await fails(alertSql(', source, late', ", 'live', true"), [T0, b(13)])).toBe('accepted'); // a live row may be late
    const [row] = await db.query<{ id: string }>(`${alertSql(', source', ", 'backfill'")} returning id`, [T0, b(14)]);
    await expect(new PgOiAlertStore(db).markFired(Number(row.id), 1_800_000_000, 1, 100)).rejects.toThrow(/oi_divergence_alerts_backfill_unsent/);
  });

  it('V33: R11 (latestOnTime) never shows a backfill row, even a newer one; the admin list shows both with their source', async () => {
    const store = new PgOiAlertStore(db);
    await db.query('delete from oi_divergence_alerts', []);
    const now = 1_800_000_000;
    const put = (source: 'live' | 'backfill', confirmedAt: number, bTime: number) => store.insertAlert({
      source, symbol: 'ETHUSDT', tf: '1h', direction: 'bullish', a: { time: bTime - 72_000, price: 1, oiTime: bTime - 72_000, oi: 1 },
      b: { time: bTime, price: 0.98, oiTime: bTime, oi: 1.03 }, runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt, late: false, build: SHA,
    });
    await put('backfill', now - 3_600, now - 7 * 3_600);
    expect(await store.latestOnTime(now)).toBeNull(); // the only row is history
    await put('live', now - 5 * 3_600, now - 12 * 3_600);
    await put('backfill', now - 1_800, now - 6 * 3_600); // newer than the live one
    expect(await store.latestOnTime(now)).toMatchObject({ source: 'live', confirmedAt: now - 5 * 3_600 });
    expect((await store.recentAlerts()).map((a) => a.source)).toEqual(['backfill', 'backfill', 'live']);
  });

  it('V31: runFirstId and hasAlert look within one source; the live measurer never takes a backfill path, and vice versa', async () => {
    const store = new PgOiAlertStore(db);
    await db.query('delete from oi_divergence_alerts', []);
    await db.query('delete from oi_divergence_controls', []);
    const bT = 1_792_000_800;
    const live = await store.insertAlert({
      source: 'live', symbol: 'SOLUSDT', tf: '1h', direction: 'bearish', a: { time: bT - 36_000, price: 1, oiTime: bT - 36_000, oi: 2 },
      b: { time: bT, price: 1.1, oiTime: bT, oi: 1.9 }, runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt: bT + 25_200, late: false, build: SHA,
    });
    expect(await store.runFirstId('live', 'SOLUSDT', '1h', 'bearish', bT)).toBe(live);
    expect(await store.runFirstId('backfill', 'SOLUSDT', '1h', 'bearish', bT)).toBeNull();
    expect(await store.hasAlert('live', 'SOLUSDT', '1h', 'bearish', bT)).toBe(true);
    expect(await store.hasAlert('backfill', 'SOLUSDT', '1h', 'bearish', bT)).toBe(false);

    const t0 = 1_792_008_000;
    const control = async (source: 'live' | 'backfill') => (await store.insertControl({
      source, symbol: 'SOLUSDT', tf: '1h', kind: 'pivot', direction: 'bullish', barTime: bT, stopPrice: 95, params: OI_DIVERGENCE_DEFAULT_PARAMS, build: SHA,
    })) as number;
    await store.insertPaths({ controlId: await control('live') }, { symbol: 'SOLUSDT', direction: 'bullish', t0, atr14: 1, stopPrice: 95 });
    await store.insertPaths({ controlId: await control('backfill') }, { symbol: 'SOLUSDT', direction: 'bullish', t0, atr14: 1, stopPrice: 95 });
    await store.insertPaths({ alertId: live as number }, { symbol: 'SOLUSDT', direction: 'bearish', t0, atr14: 1, stopPrice: 1.1 });
    const later = t0 + 72 * 3_600 + 60;
    const due = async (source: 'live' | 'backfill') => (await store.pathsDue(source, later, 100, 900)).map((d) => d.id);
    const [{ ids: liveIds }] = await db.query<{ ids: string[] }>(
      `select array_agg(p.id order by p.id)::text[] ids from oi_divergence_paths p left join oi_divergence_controls c on c.id = p.control_id
        where p.alert_id is not null or c.source = 'live'`, []);
    const [{ ids: backIds }] = await db.query<{ ids: string[] }>(
      `select array_agg(p.id order by p.id)::text[] ids from oi_divergence_paths p join oi_divergence_controls c on c.id = p.control_id where c.source = 'backfill'`, []);
    expect((await due('live')).sort((a, b) => a - b)).toEqual(liveIds.map(Number));
    expect((await due('backfill')).sort((a, b) => a - b)).toEqual(backIds.map(Number));
    expect(liveIds).toHaveLength(6);
    expect(backIds).toHaveLength(3);
    const reads = new PgBackfillReads(db);
    expect(await reads.unmeasuredBackfillPaths()).toEqual({ count: 3, lastCloses: t0 + 72 * 3_600 });
    expect(await reads.backfillCounts()).toMatchObject({ alerts: 0, controls_pivot: 1, controls_random: 0, near_misses: 1, paths: 3 });
  });

  it('liveStart is the first LIVE control; a backfill control earlier than it does not move it', async () => {
    await db.query('delete from oi_divergence_controls', []);
    const reads = new PgBackfillReads(db);
    expect(await reads.liveStart()).toBeNull();
    await db.query(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build, source, created_at) values ('BTCUSDT', '4h', 'random', null, $1, null, '{}', $2, 'live', $3)`,
      [T0, SHA, new Date(Date.UTC(2026, 10, 4, 21, 41, 43))]);
    await db.query(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build, source, created_at) values ('BTCUSDT', '4h', 'random', null, $1, null, '{}', $2, 'backfill', $3)`,
      [T0, SHA, new Date(Date.UTC(2026, 10, 1))]);
    expect(await reads.liveStart()).toBe(Date.UTC(2026, 10, 4, 21, 41, 43) / 1000);
  });

  it('undo removes the backfill rows and the column, restoring the old keys; 028 re-applies with the live rows as live', async () => {
    await runMigrations({ connectionString: url, target: '027' });
    for (const table of TABLES) {
      const [c] = await db.query<{ n: number }>(`select count(*)::int n from information_schema.columns where table_name = $1 and column_name = 'source'`, [table]);
      expect([table, c.n]).toEqual([table, 0]);
    }
    const [{ n }] = await db.query<{ n: number }>(`select count(*)::int n from oi_divergence_controls`, []);
    expect(n).toBe(1); // the live control stays, the backfill one went
    await runMigrations({ connectionString: url });
    expect(await db.query(`select distinct source from oi_divergence_controls`, [])).toEqual([{ source: 'live' }]);
  }, DB_HOOK_TIMEOUT_MS);
});

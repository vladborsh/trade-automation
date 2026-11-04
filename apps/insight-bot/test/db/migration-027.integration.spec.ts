import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { OI_CONTROL_KINDS, OI_NEAR_MISS_RULES, OI_NEAR_MISS_UNIT, OI_RESEARCH_WINDOWS } from '@trade-automation/contracts';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-115 — migration 027 on a database at 026 that already holds a journal row: the row reads
 * 'pre-027', the column is NOT NULL with no default (a writer that forgets the build fails), the three
 * research tables with their guards, and a clean undo + re-apply.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-027.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const TABLES = ['oi_divergence_controls', 'oi_divergence_near_misses', 'oi_divergence_paths'];
const T0 = new Date(Date.UTC(2026, 10, 1, 12));
const T1 = new Date(Date.UTC(2026, 10, 2, 12));
const SHA = 'b49cd48d4ab4';

maybeDescribe('IB-115 migration 027: build stamp, controls, near-misses, paths', () => {
  let name: string;
  let url: string;
  let admin: Client;
  let db: PgDatabase;

  const exists = async (table: string): Promise<boolean> =>
    (await db.query<{ t: string | null }>(`select to_regclass($1)::text as t`, [`public.${table}`]))[0].t !== null;
  const fails = async (sql: string, params: unknown[] = []): Promise<string> => {
    try {
      await db.query(sql, params);
      return 'accepted';
    } catch (e) {
      return (e as Error).message;
    }
  };
  const ALERT_COLS = 'symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, params, confirmed_at';
  const control = (kind: string, direction: string | null, stop: number | null, barTime: Date, build: string | null = SHA) => db.query<{ id: string }>(
    `insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build)
     values ('BTCUSDT', '1h', $1, $2, $3, $4, '{}', $5) returning id`, [kind, direction, barTime, stop, build]);
  const nearMiss = (rule: string, unit: string, bTime: Date, build: string | null = SHA) => db.query<{ id: string }>(
    `insert into oi_divergence_near_misses (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi,
       rule, miss, unit, params, confirmed_at, build)
     values ('BTCUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 98, $2, 1050, $3, 0.4, $4, '{}', $2, $5) returning id`, [T0, bTime, rule, unit, build]);

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m027', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '026' });
    db = new PgDatabase(url);
    expect(await exists('oi_divergence_controls')).toBe(false); // 026 is the base: the tables below are 027's
    await db.query(`insert into oi_divergence_alerts (${ALERT_COLS}) values ('ETHUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 98, $2, 1050, '{}', $2)`, [T0, T1]);
    await runMigrations({ connectionString: url, target: '027' }); // 027's schema: 028 (IB-116) adds a required source
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it.each(TABLES)('creates %s', async (table) => {
    expect(await exists(table)).toBe(true);
  });

  it('V27: the journal row from before 027 reads pre-027; a new row without a build is refused (NOT NULL, no default)', async () => {
    const rows = await db.query<{ build: string }>('select build from oi_divergence_alerts', []);
    expect(rows).toEqual([{ build: 'pre-027' }]);
    const [col] = await db.query<{ is_nullable: string; column_default: string | null }>(
      `select is_nullable, column_default from information_schema.columns where table_name = 'oi_divergence_alerts' and column_name = 'build'`, []);
    expect(col).toEqual({ is_nullable: 'NO', column_default: null });
    const insert = `insert into oi_divergence_alerts (${ALERT_COLS}, build) values ('BTCUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 98, $2, 1050, '{}', $2, $3)`;
    expect(await fails(`insert into oi_divergence_alerts (${ALERT_COLS}) values ('BTCUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 98, $2, 1050, '{}', $2)`, [T0, T1]))
      .toMatch(/null value in column "build"/);
    expect(await fails(insert, [T0, T1, ''])).toMatch(/oi_divergence_alerts_build/);
    expect(await fails(insert, [T0, T1, 'sha-b49cd48d4ab4'])).toMatch(/oi_divergence_alerts_build/);
    expect(await fails(insert, [T0, T1, SHA])).toBe('accepted');
  });

  it('V25: controls — pivot carries a direction and a stop, random neither; once per (symbol, tf, kind, direction, bar)', async () => {
    expect(await fails(`select 1 from oi_divergence_controls where kind = any($1)`, [[...OI_CONTROL_KINDS]])).toBe('accepted');
    await control('pivot', 'bullish', 97, T0);
    await control('pivot', 'bearish', 103, T0); // one wide bar, both pivots: two controls
    await control('random', null, null, T0);
    expect(await fails(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build)
      values ('BTCUSDT', '1h', 'pivot', 'bullish', $1, 97, '{}', $2)`, [T0, SHA])).toMatch(/oi_divergence_controls_once/);
    expect(await fails(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build)
      values ('BTCUSDT', '1h', 'random', null, $1, null, '{}', $2)`, [T0, SHA])).toMatch(/oi_divergence_controls_once/); // nulls not distinct
    expect(await fails(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build)
      values ('BTCUSDT', '1h', 'random', 'bullish', $1, null, '{}', $2)`, [T1, SHA])).toMatch(/oi_divergence_controls_shape/);
    expect(await fails(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build)
      values ('BTCUSDT', '1h', 'pivot', 'bullish', $1, null, '{}', $2)`, [T1, SHA])).toMatch(/oi_divergence_controls_shape/);
    expect(await fails(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params)
      values ('BTCUSDT', '1h', 'random', null, $1, null, '{}')`, [T1])).toMatch(/null value in column "build"/);
    expect(await fails(`insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build)
      values ('BTCUSDT', '1h', 'random', null, $1, null, '{}', 'pre-027')`, [T1])).toMatch(/check constraint/); // only the journal has a past
  });

  it('V26: near-misses — each rule with its own unit, one per (symbol, tf, direction, B), never without a build', async () => {
    let day = 3;
    for (const rule of OI_NEAR_MISS_RULES) {
      const b = new Date(Date.UTC(2026, 10, day++, 12));
      expect([rule, await fails(`select 1`), (await nearMiss(rule, OI_NEAR_MISS_UNIT[rule], b)).length]).toEqual([rule, 'accepted', 1]);
    }
    const b = new Date(Date.UTC(2026, 10, 20, 12));
    expect(await fails(`insert into oi_divergence_near_misses (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi,
       rule, miss, unit, params, confirmed_at, build) values ('BTCUSDT', '1h', 'bullish', $1, 1, $1, 1, $2, 1, $2, 1, 'k', 1, 'atr14', '{}', $2, $3)`, [T0, b, SHA]))
      .toMatch(/oi_divergence_near_misses_unit/);
    await nearMiss('w', 'bars', b);
    expect(await fails(`insert into oi_divergence_near_misses (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi,
       rule, miss, unit, params, confirmed_at, build) values ('BTCUSDT', '1h', 'bullish', $1, 1, $1, 1, $2, 1, $2, 1, 'k', 1, 'bars', '{}', $2, $3)`, [T0, b, SHA]))
      .toMatch(/oi_divergence_near_misses_once/);
    expect(await fails(`insert into oi_divergence_near_misses (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi,
       rule, miss, unit, params, confirmed_at) values ('BTCUSDT', '1h', 'bearish', $1, 1, $1, 1, $2, 1, $2, 1, 'k', 1, 'bars', '{}', $2)`, [T0, b]))
      .toMatch(/null value in column "build"/);
  });

  it('V24: a path row belongs to exactly one subject, once per window, t0 on a 5 m boundary', async () => {
    const [c] = await control('pivot', 'bullish', 95, T1);
    const path = (subject: string, id: string | null, win: string, t0: Date) => fails(
      `insert into oi_divergence_paths (${subject}, win, symbol, direction, t0, atr14, stop_price) values ($1, $2, 'BTCUSDT', 'bullish', $3, 12.5, 95)`, [id, win, t0]);
    for (const win of OI_RESEARCH_WINDOWS) expect(await path('control_id', c.id, win, T1)).toBe('accepted');
    expect(await path('control_id', c.id, '4h', T1)).toMatch(/oi_divergence_paths_control_once/);
    expect(await path('control_id', c.id, '1w', T1)).toMatch(/check constraint/);
    expect(await path('control_id', null, '4h', T1)).toMatch(/oi_divergence_paths_subject/);
    expect(await fails(`insert into oi_divergence_paths (control_id, near_miss_id, win, symbol, t0, atr14) values ($1, $1, '4h', 'BTCUSDT', $2, 1)`, [c.id, T1]))
      .toMatch(/oi_divergence_paths_subject/);
    const [c2] = await control('pivot', 'bearish', 105, T1);
    expect(await path('control_id', c2.id, '4h', new Date(T1.getTime() + 60_000))).toMatch(/check constraint/); // not on 5 m
    expect(await fails(`update oi_divergence_paths set measured_at = now() where control_id = $1`, [c.id])).toMatch(/oi_divergence_paths_measured/);
    expect(await fails(`update oi_divergence_paths set measured_at = now(), bars = 48 where control_id = $1 and win = '4h'`, [c.id])).toBe('accepted');
    await db.query('delete from oi_divergence_controls where id = $1', [c.id]);
    const [n] = await db.query<{ n: number }>('select count(*)::int n from oi_divergence_paths where control_id = $1', [c.id]);
    expect(n.n).toBe(0); // the subject owns its paths
  });

  it('undo removes the three tables and the build column; 027 re-applies and stamps pre-027 again', async () => {
    await runMigrations({ connectionString: url, target: '026' });
    for (const table of TABLES) expect([table, await exists(table)]).toEqual([table, false]);
    const [c] = await db.query<{ n: number }>(`select count(*)::int n from information_schema.columns where table_name = 'oi_divergence_alerts' and column_name = 'build'`, []);
    expect(c.n).toBe(0);
    await runMigrations({ connectionString: url, target: '027' });
    const rows = await db.query<{ build: string }>('select distinct build from oi_divergence_alerts', []);
    expect(rows).toEqual([{ build: 'pre-027' }]);
  }, DB_HOOK_TIMEOUT_MS);
});

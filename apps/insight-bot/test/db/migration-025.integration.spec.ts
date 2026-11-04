import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-109 — migration 025 on a database at 024 that already has an admin and a member: the four
 * tables and their seeds, `users.oi_alerts` on for the admin only, the guards that make the journal
 * idempotent (V8) and the settings a single row, and a clean undo + re-apply.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-025.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const TABLES = ['alert_symbols', 'alert_settings', 'oi_divergence_alerts', 'oi_divergence_skips'];
/**
 * 025's seed, as round 1 ruled it. A literal, not OI_DIVERGENCE_DEFAULT_PARAMS: 025 is MD5-frozen, and the
 * defaults moved on in IB-114 (migration 026, whose spec compares the END of the chain with the contract).
 */
const ROUND_1_SEED = {
  perTf: { '15m': { n: 6, k: 3, w: 96 }, '1h': { n: 6, k: 3, w: 120 }, '4h': { n: 6, k: 3, w: 90 } },
  atrMult: 0.25,
  oiMedianMult: 0.5,
};
const T0 = new Date(Date.UTC(2026, 10, 1, 12));
const T1 = new Date(Date.UTC(2026, 10, 2, 12));

maybeDescribe('IB-109 migration 025: alert list, settings, journal, skips, users.oi_alerts', () => {
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
  const alert = (aTime: Date, bTime: Date) => db.query(
    `insert into oi_divergence_alerts (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, params, confirmed_at)
     values ('BTCUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 98, $2, 1050, '{}', $2)`, [aTime, bTime]);

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m025', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '024' });
    db = new PgDatabase(url);
    await db.query(`insert into users (id, tg_user_id, role) values (1, 101, 'admin'), (2, 102, 'member')`, []);
    expect(await exists('alert_symbols')).toBe(false); // 024 is the base: the tables below are 025's
    await runMigrations({ connectionString: url, target: '025' });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it.each(TABLES)('creates %s', async (table) => {
    expect(await exists(table)).toBe(true);
  });

  it('seeds the owner’s five coins, enabled, added by nobody', async () => {
    const rows = await db.query<{ symbol: string; base: string; enabled: boolean; added_by: number | null }>(
      'select symbol, base, enabled, added_by from alert_symbols order by symbol', []);
    expect(rows).toEqual(['BNB', 'BTC', 'ETH', 'SOL', 'TRX'].map((b) => ({ symbol: `${b}USDT`, base: b, enabled: true, added_by: null })));
    expect(await fails(`insert into alert_symbols (symbol, base) values ('trx/usdt', 'TRX')`)).toMatch(/check constraint/);
  });

  it('one settings row, both switches OFF, params exactly round 1’s seed', async () => {
    const [s] = await db.query<{ enabled: boolean; members_visible: boolean; params: unknown }>('select enabled, members_visible, params from alert_settings', []);
    expect(s.enabled).toBe(false);
    expect(s.members_visible).toBe(false);
    expect(s.params).toEqual(ROUND_1_SEED);
    expect(await fails(`insert into alert_settings (id, params) values (2, '{}')`)).toMatch(/check constraint/);
    expect(await fails(`insert into alert_settings (params) values ('{}')`)).toMatch(/duplicate key/);
  });

  it('oi_alerts: on for the admin who existed, off for the member and for anyone created later', async () => {
    await db.query(`insert into users (id, tg_user_id, role) values (3, 103, 'admin')`, []);
    const rows = await db.query<{ id: number; oi_alerts: boolean }>('select id, oi_alerts from users order by id', []);
    expect(rows).toEqual([{ id: 1, oi_alerts: true }, { id: 2, oi_alerts: false }, { id: 3, oi_alerts: false }]);
  });

  it('the journal takes an alert once per (symbol, tf, direction, A, B) and refuses B before A', async () => {
    await alert(T0, T1);
    expect(await fails(`insert into oi_divergence_alerts (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, params, confirmed_at)
                        values ('BTCUSDT', '1h', 'bullish', $1, 1, $1, 1, $2, 1, $2, 1, '{}', $2)`, [T0, T1])).toMatch(/oi_divergence_alerts_once/);
    expect(await fails(`insert into oi_divergence_alerts (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, params, confirmed_at)
                        values ('BTCUSDT', '1h', 'bullish', $2, 1, $2, 1, $1, 1, $1, 1, '{}', $2)`, [T0, T1])).toMatch(/oi_divergence_alerts_order/);
    expect(await fails(`update oi_divergence_alerts set tf = '5m'`)).toMatch(/check constraint/);
    const [r] = await db.query<{ run_length: number; late: boolean; recipients: number; fired_at: Date | null }>(
      'select run_length, late, recipients, fired_at from oi_divergence_alerts', []);
    expect(r).toEqual({ run_length: 2, late: false, recipients: 0, fired_at: null });
  });

  it('a skip is logged once per (symbol, tf, bar, reason)', async () => {
    const skip = `insert into oi_divergence_skips (symbol, tf, bar_time, reason, hole_from, hole_to) values ('TRXUSDT', '15m', $1, 'no_oi_data', $1, $1)`;
    await db.query(skip, [T0]);
    expect(await fails(skip, [T0])).toMatch(/oi_divergence_skips_once/);
    expect(await fails(`insert into oi_divergence_skips (symbol, tf, bar_time, reason, hole_from, hole_to) values ('TRXUSDT', '15m', $1, 'other', $1, $1)`, [T1])).toMatch(/check constraint/);
  });

  it('undo removes the four tables and the column; 025 re-applies with its seeds', async () => {
    await runMigrations({ connectionString: url, target: '024' });
    for (const table of TABLES) expect([table, await exists(table)]).toEqual([table, false]);
    const [c] = await db.query<{ n: number }>(`select count(*)::int n from information_schema.columns where table_name = 'users' and column_name = 'oi_alerts'`, []);
    expect(c.n).toBe(0);
    await runMigrations({ connectionString: url, target: '025' });
    const [n] = await db.query<{ n: number }>('select count(*)::int n from alert_symbols', []);
    expect(n.n).toBe(5);
  }, DB_HOOK_TIMEOUT_MS);
});

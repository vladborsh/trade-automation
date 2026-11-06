import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { LEVEL_DEFAULT_PARAMS, LevelParamsSchema, WebLevelAlertsAdminResponseSchema } from '@trade-automation/contracts';
import { LevelAlertsAdmin, LevelAlertsAdminNotListed } from '../../src/alerts/levels/level-alerts-admin';
import { PgLevelAlertStore, PgLevelAlertsVisibility, stateKey } from '../../src/alerts/levels/pg/level-alerts.repo';
import { PgOiAlertStore } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-126 — migration 035 on a database at 034 that holds an admin and a member:
 * - the 'level' settings row, both switches OFF, params EQUAL to the contracts' defaults;
 * - `level_alerts` on for the admin that existed, off for the member;
 * - `alert_level_state`: one row per (source, symbol, kind, period start), high/low kinds only;
 * - the store against real rows: a bar's alerts and its state commit together, a failure rolls BOTH back; writing a
 *   period's row deletes that level's earlier periods; the once-key absorbs a repeat; `late` is stored; paths queued;
 * - the admin section: defaults, event switches merged (true removes the exception), a coin's daily switch, an
 *   unlisted coin refused;
 * - undo removes it all; 035 re-applies.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-035.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const NOW = Date.UTC(2026, 10, 11, 10, 15, 5);
const WEEK = Date.UTC(2026, 10, 9);
const BAR = Date.UTC(2026, 10, 11, 10, 0);

maybeDescribe('IB-126 migration 035: level settings, recipients, state', () => {
  let name: string;
  let url: string;
  let admin: Client;
  let db: PgDatabase;
  let adminId: number;

  const fails = async (sql: string, params: unknown[] = []): Promise<string> => {
    try {
      await db.query(sql, params);
      return 'accepted';
    } catch (e) {
      return (e as Error).message;
    }
  };

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m035', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '034' });
    db = new PgDatabase(url);
    const [a] = await db.query<{ id: number }>(`insert into users (tg_user_id, chat_id, role, lang) values (1, 1001, 'admin', 'en') returning id`);
    adminId = a.id;
    await db.query(`insert into users (tg_user_id, chat_id, role) values (2, 1002, 'member')`);
    await db.query(`delete from alert_symbols where symbol not in ('BTCUSDT', 'TRXUSDT')`);
    await db.query(`update alert_symbols set enabled = (symbol = 'BTCUSDT')`);
    await runMigrations({ connectionString: url });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('§1 Settings: the level row, both switches OFF, params equal to the contracts\' defaults', async () => {
    const rows = await db.query<{ enabled: boolean; members_visible: boolean; params: unknown }>(`select enabled, members_visible, params from alert_type_settings where type = 'level'`);
    expect(rows).toEqual([{ enabled: false, members_visible: false, params: LEVEL_DEFAULT_PARAMS }]);
    expect(LevelParamsSchema.safeParse(rows[0]?.params).success).toBe(true);
    expect(await new PgLevelAlertsVisibility(db).membersVisible()).toBe(false);
    expect((await db.query<{ type: string }>('select type from alert_type_settings order by type')).map((r) => r.type)).toEqual(['funding', 'level', 'liq']);
  });

  it('§1 Recipients: level_alerts on for the admin that existed, off for the member', async () => {
    expect(await db.query('select role, level_alerts from users order by id')).toEqual([{ role: 'admin', level_alerts: true }, { role: 'member', level_alerts: false }]);
    expect(await new PgLevelAlertStore(db).recipients()).toEqual([{ chatId: 1001, lang: 'en' }]);
  });

  it('P10: the state table takes high/low kinds only, and refuses a first-beyond without a side', async () => {
    const ins = (kind: string, side: string, beyond: string) =>
      `insert into alert_level_state (source, symbol, kind, period_start, price, last_side, first_beyond_at, last_bar_at) values ('live', 'X', '${kind}', '2026-11-09T00:00:00Z', 1, ${side}, ${beyond}, now())`;
    expect(await fails(ins('WO', 'null', 'null'))).toMatch(/check constraint/);
    expect(await fails(ins('PWH', 'null', 'now()'))).toMatch(/alert_level_state_beyond/);
    expect(await fails(ins('PWH', `'up'`, 'null'))).toMatch(/check constraint/);
    expect(await fails(ins('PWH', `'above'`, 'now()'))).toBe('accepted');
    expect(await fails(ins('PWH', `'above'`, 'now()'))).toMatch(/alert_level_state_pkey/);
    await db.query('delete from alert_level_state');
  });

  it('the store: alerts and state commit together; a repeat is absorbed; late is kept; a new period deletes the old; a failure rolls back both', async () => {
    const store = new PgLevelAlertStore(db);
    const state = { lastSide: 'above' as const, firstBeyondAtMs: BAR + 900_000, lastBarMs: BAR };
    const details = { kind: 'PWH', price: 100, periodStartMs: WEEK, periodEndMs: WEEK + 7 * 86_400_000, bar: { openMs: BAR, open: 99, high: 102, low: 98, close: 101 }, prevClose: 99, firstBeyondAtMs: null };
    const commit = (dedupeKey: string, late = false) => store.commit({
      source: 'live', build: 'dev', params: LEVEL_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol: 'BTCUSDT',
      states: [{ kind: 'PWH', periodStartMs: WEEK, price: 100, state }],
      alerts: [{ event: 'breakout_up', symbol: 'BTCUSDT', direction: 'bullish', atMs: BAR, late, details, dedupeKey }],
    });
    const [id] = await commit(`level:BTCUSDT:PWH:${WEEK}:breakout_up`);
    expect(typeof id).toBe('number');
    expect(await commit(`level:BTCUSDT:PWH:${WEEK}:breakout_up`)).toEqual([null]);
    const [lateId] = await commit('late-one', true);
    expect(await db.query('select late from market_alerts where id = $1', [lateId])).toEqual([{ late: true }]);
    const states = await store.states('live');
    expect(states.get(stateKey('BTCUSDT', 'PWH', WEEK))).toEqual({ symbol: 'BTCUSDT', kind: 'PWH', periodStartMs: WEEK, price: 100, state });
    expect(await store.states('backfill')).toEqual(new Map());
    const [row] = await db.query<{ type: string; tf: string; direction: string; event: string; at: Date }>('select type, tf, direction, event, at from market_alerts where id = $1', [id]);
    expect(row).toEqual({ type: 'level', tf: '15m', direction: 'bullish', event: 'breakout_up', at: new Date(BAR) });

    // a new week's row deletes last week's for the same level, not another level's
    await store.commit({ source: 'live', build: 'dev', params: LEVEL_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol: 'BTCUSDT', states: [{ kind: 'PWL', periodStartMs: WEEK, price: 80, state }], alerts: [] });
    const NEXT = WEEK + 7 * 86_400_000;
    await store.commit({ source: 'live', build: 'dev', params: LEVEL_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol: 'BTCUSDT', states: [{ kind: 'PWH', periodStartMs: NEXT, price: 101, state: { ...state, lastBarMs: NEXT } }], alerts: [] });
    expect([...(await store.states('live')).keys()].sort()).toEqual([stateKey('BTCUSDT', 'PWH', NEXT), stateKey('BTCUSDT', 'PWL', WEEK)].sort());

    // a state row the table refuses rolls back the alert written in the same commit
    await expect(store.commit({
      source: 'live', build: 'dev', params: LEVEL_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol: 'ETHUSDT',
      states: [{ kind: 'PWH', periodStartMs: WEEK, price: -1, state }],
      alerts: [{ event: 'breakout_up', symbol: 'ETHUSDT', direction: 'bullish', atMs: BAR, late: false, details, dedupeKey: 'rolled-back' }],
    })).rejects.toThrow(/check constraint/);
    expect(await db.query(`select 1 from market_alerts where dedupe_key = 'rolled-back'`)).toEqual([]);

    await store.insertPaths({ marketAlertId: id as number }, 'BTCUSDT', (BAR + 900_000) / 1000);
    const due = await new PgOiAlertStore(db).pathsDue('live', (BAR + 900_000) / 1000 + 5 * 3_600, 10, 900);
    expect(due.map((d) => d.win)).toEqual(['4h']);
    const cid = await store.insertControl('live', 'dev', LEVEL_DEFAULT_PARAMS, { kind: 'touch', symbol: 'BTCUSDT', atMs: BAR, details: {}, dedupeKey: 'level-touch:1' });
    expect(await store.insertControl('live', 'dev', LEVEL_DEFAULT_PARAMS, { kind: 'touch', symbol: 'BTCUSDT', atMs: BAR, details: {}, dedupeKey: 'level-touch:1' })).toBeNull();
    expect(await db.query('select type, kind, direction from market_alert_controls where id = $1', [cid])).toEqual([{ type: 'level', kind: 'touch', direction: null }]);
    await store.markFired(id as number, NOW, 1);
    const page = await store.journalPage();
    expect(page.find((r) => r.id === id)).toMatchObject({ event: 'breakout_up', kind: 'PWH', price: 100, close: 101, at: BAR / 1000, recipients: 1, late: false });
  });

  it('the admin section: every event on by default, a switch off and back on (no stored true), daily per coin, unlisted refused', async () => {
    const adm = new LevelAlertsAdmin(new PgLevelAlertStore(db));
    const page = await adm.page();
    expect(WebLevelAlertsAdminResponseSchema.safeParse(page).success).toBe(true);
    expect(page.events.PWH).toEqual({ breakout_up: true, sweep_above: true, crossunder: true });
    expect(page.events.WO).toEqual({ breakout_up: true, breakout_down: true, sweep_above: true, sweep_below: true });
    expect(page.coins).toEqual([
      { symbol: 'BTCUSDT', base: 'BTC', listed: true, enabled: true, daily: false, stateRows: 2 },
      { symbol: 'TRXUSDT', base: 'TRX', listed: false, enabled: true, daily: false, stateRows: 0 },
    ]);
    const off = await adm.patch({ events: { PWH: { crossunder: false } }, perCoin: { BTCUSDT: { enabled: true, daily: true } }, touchBand: 0.002 }, adminId);
    expect(off.settings.params).toEqual({ touchBand: 0.002, events: { PWH: { crossunder: false } }, perCoin: { BTCUSDT: { enabled: true, daily: true } } });
    expect(off.events.PWH).toEqual({ breakout_up: true, sweep_above: true, crossunder: false });
    const back = await adm.patch({ events: { PWH: { crossunder: true } } }, adminId);
    expect(back.settings.params.events).toEqual({});
    await expect(adm.patch({ perCoin: { SOLUSDT: { enabled: true, daily: false } } }, adminId)).rejects.toBeInstanceOf(LevelAlertsAdminNotListed);
    const on = await adm.patch({ enabled: true }, adminId);
    expect(on.settings.enabled).toBe(true);
    expect((await db.query<{ updated_by: number }>(`select updated_by from alert_type_settings where type = 'level'`))[0]?.updated_by).toBe(adminId);
    await adm.patch({ enabled: false, touchBand: 0.001, perCoin: { BTCUSDT: { enabled: true, daily: false } } }, adminId);
  });

  it('undo removes the level rows, the state, the column and the settings row; 035 re-applies', async () => {
    await runMigrations({ connectionString: url, target: '034' });
    expect(await db.query(`select 1 from market_alerts where type = 'level'`)).toEqual([]);
    expect(await db.query(`select 1 from market_alert_controls where type = 'level'`)).toEqual([]);
    expect(await db.query(`select 1 from alert_type_settings where type = 'level'`)).toEqual([]);
    expect(await fails('select 1 from alert_level_state')).toMatch(/does not exist/);
    expect(await fails('select level_alerts from users')).toMatch(/does not exist/);
    await runMigrations({ connectionString: url });
    expect(await db.query(`select params from alert_type_settings where type = 'level'`)).toEqual([{ params: LEVEL_DEFAULT_PARAMS }]);
  });
});

import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { FUNDING_DEFAULT_PARAMS, FundingParamsSchema, WebFundingAlertsAdminResponseSchema } from '@trade-automation/contracts';
import { FundingAlertsAdmin, FundingAlertsAdminNotListed } from '../../src/alerts/funding/funding-alerts-admin';
import type { FundingSideState } from '../../src/alerts/funding/funding-state';
import { PgFundingAlertStore, PgFundingAlertsVisibility } from '../../src/alerts/funding/pg/funding-alerts.repo';
import { PgOiAlertStore } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-124 — migration 034 on a database at 033 that holds an admin and a member:
 * - the 'funding' settings row, both switches OFF, params EQUAL to the contracts' defaults;
 * - `funding_alerts` on for the admin that existed, off for the member;
 * - `alert_funding_state`: one row per (source, symbol, side), its consistency checks;
 * - the store against real rows: state round-trips; an `enter` and its state commit together, a failure rolls BOTH
 *   back; the once-key absorbs a repeat; paths are queued for the shared measurer; recipients;
 * - the admin section: defaults, a coin floor and its removal, an unlisted coin refused;
 * - undo removes it all; 034 re-applies.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-034.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const H = 3_600_000;
const STATE: FundingSideState = {
  zone: 'extreme', since: NOW - 30 * H, outChecks: 2, outSince: NOW - 600_000, episodeStart: NOW - 100 * H, episodeEnd: NOW - 70 * H,
  oppChecks: 0, oppSince: null, flipSent: true, lastCheckAt: NOW,
};

maybeDescribe('IB-124 migration 034: funding settings, recipients, state', () => {
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
    const prefix = scratchPrefix('insight_m034', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '033' });
    db = new PgDatabase(url);
    const [a] = await db.query<{ id: number }>(`insert into users (tg_user_id, chat_id, role, lang) values (1, 1001, 'admin', 'en') returning id`);
    adminId = a.id;
    await db.query(`insert into users (tg_user_id, chat_id, role) values (2, 1002, 'member')`);
    // 025 seeded five coins: keep BTC (listed) and TRX (delisted), so SOL is a coin that is not on the list
    await db.query(`delete from alert_symbols where symbol not in ('BTCUSDT', 'TRXUSDT')`);
    await db.query(`update alert_symbols set enabled = (symbol = 'BTCUSDT')`);
    await runMigrations({ connectionString: url });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('§1 Settings: the funding row, both switches OFF, params equal to the contracts\' defaults', async () => {
    const rows = await db.query<{ enabled: boolean; members_visible: boolean; params: unknown }>(`select enabled, members_visible, params from alert_type_settings where type = 'funding'`);
    expect(rows).toEqual([{ enabled: false, members_visible: false, params: FUNDING_DEFAULT_PARAMS }]);
    expect(FundingParamsSchema.safeParse(rows[0]?.params).success).toBe(true);
    expect(await new PgFundingAlertsVisibility(db).membersVisible()).toBe(false);
    // the liq row is untouched
    // `where type <> 'level'`: the chain runs to the end, and 035 (IB-126) adds the 'level' row (its own spec)
    expect((await db.query<{ type: string }>(`select type from alert_type_settings where type <> 'level' order by type`)).map((r) => r.type)).toEqual(['funding', 'liq']);
  });

  it('§1 Recipients: funding_alerts on for the admin that existed, off for the member', async () => {
    expect(await db.query('select role, funding_alerts from users order by id')).toEqual([{ role: 'admin', funding_alerts: true }, { role: 'member', funding_alerts: false }]);
    expect(await new PgFundingAlertStore(db).recipients()).toEqual([{ chatId: 1001, lang: 'en' }]);
  });

  it('F6: the state table refuses an inconsistent row (episode end without start, a streak count without its start)', async () => {
    const ins = (cols: string, vals: string) => `insert into alert_funding_state (source, symbol, side, zone, since, last_check_at${cols}) values ('live', 'X', 'high', 'normal', now(), now()${vals})`;
    expect(await fails(ins(', episode_end', ', now()'))).toMatch(/alert_funding_state_episode/);
    expect(await fails(ins(', episode_start, episode_end', `, now(), now() - interval '1 h'`))).toMatch(/alert_funding_state_episode/);
    expect(await fails(ins(', out_checks', ', 1'))).toMatch(/alert_funding_state_out/);
    expect(await fails(ins(', opp_since', ', now()'))).toMatch(/alert_funding_state_opp/);
    expect(await fails(ins('', '').replace("'high'", "'up'"))).toMatch(/check constraint/);
    expect(await fails(ins('', ''))).toBe('accepted');
    expect(await fails(ins('', ''))).toMatch(/alert_funding_state_pkey/);
    await db.query('delete from alert_funding_state');
  });

  it('the store: an enter and its state commit together; a repeat is absorbed; a failure rolls back both; state round-trips', async () => {
    const store = new PgFundingAlertStore(db);
    const commit = (dedupeKey: string, symbol = 'BTCUSDT') => store.commit({
      source: 'live', build: 'dev', params: FUNDING_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol,
      states: [{ side: 'high', state: STATE }, { side: 'low', state: { ...STATE, zone: 'normal', outChecks: 0, outSince: null, episodeStart: null, episodeEnd: null, flipSent: false } }],
      alerts: [{ event: 'enter', symbol, direction: 'bearish', atMs: NOW - 30 * H, details: { side: 'high', rate: 0.0005, intervalH: 8, ratePer8h: 0.0005 }, dedupeKey }],
    });
    const [id] = await commit('funding:BTCUSDT:high:1');
    expect(typeof id).toBe('number');
    expect(await commit('funding:BTCUSDT:high:1')).toEqual([null]);
    const states = await store.states('live');
    expect(states.get('BTCUSDT|high')).toEqual(STATE);
    expect(states.get('BTCUSDT|low')).toMatchObject({ zone: 'normal', episodeStart: null });
    expect(await store.states('backfill')).toEqual(new Map());
    const [row] = await db.query<{ type: string; tf: string; direction: string; late: boolean; source: string }>('select type, tf, direction, late, source from market_alerts where id = $1', [id]);
    expect(row).toEqual({ type: 'funding', tf: '1h', direction: 'bearish', late: false, source: 'live' });

    // a state row the table refuses (an episode end before its start) rolls back the alert written in the same commit
    const bad = { ...STATE, episodeEnd: STATE.episodeStart! - 1 };
    await expect(store.commit({
      source: 'live', build: 'dev', params: FUNDING_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol: 'ETHUSDT', states: [{ side: 'high', state: bad }],
      alerts: [{ event: 'enter', symbol: 'ETHUSDT', direction: 'bearish', atMs: NOW, details: {}, dedupeKey: 'funding:ETHUSDT:high:2' }],
    })).rejects.toThrow(/alert_funding_state_episode/);
    expect(await db.query(`select 1 from market_alerts where dedupe_key = 'funding:ETHUSDT:high:2'`)).toEqual([]);

    await store.insertPaths({ marketAlertId: id as number }, 'BTCUSDT', (NOW - 30 * H) / 1000);
    const due = await new PgOiAlertStore(db).pathsDue('live', NOW / 1000, 10, 900);
    expect(due.map((d) => d.win).sort()).toEqual(['24h', '4h']); // 30 h ago: the 72 h window is still open
    const cid = await store.insertControl('live', 'dev', FUNDING_DEFAULT_PARAMS, { kind: 'random', symbol: 'BTCUSDT', direction: null, atMs: NOW, details: {}, dedupeKey: 'funding-rnd:BTCUSDT:1' });
    expect(await store.insertControl('live', 'dev', FUNDING_DEFAULT_PARAMS, { kind: 'random', symbol: 'BTCUSDT', direction: null, atMs: NOW, details: {}, dedupeKey: 'funding-rnd:BTCUSDT:1' })).toBeNull();
    expect(await db.query('select type, kind from market_alert_controls where id = $1', [cid])).toEqual([{ type: 'funding', kind: 'random' }]);
    await store.markFired(id as number, NOW, 1);
    expect((await store.journalPage()).map((r) => [r.event, r.symbol, r.side, r.rate, r.intervalH, r.recipients])).toEqual([['enter', 'BTCUSDT', 'high', 0.0005, 8, 1]]);
  });

  it('the admin section: the shared default floor, a coin floor set then removed, F5 bounds, an unlisted coin refused', async () => {
    const adm = new FundingAlertsAdmin(new PgFundingAlertStore(db));
    const page = await adm.page();
    expect(WebFundingAlertsAdminResponseSchema.safeParse(page).success).toBe(true);
    expect(page.defaultFloorPer8h).toBe(0.0003);
    expect(page.coins).toEqual([
      { symbol: 'BTCUSDT', base: 'BTC', listed: true, enabled: true, floorPer8h: null },
      { symbol: 'TRXUSDT', base: 'TRX', listed: false, enabled: true, floorPer8h: null },
    ]);
    const set = await adm.patch({ perCoin: { BTCUSDT: { enabled: true, floorPer8h: 0.0005 } }, minEpisodeHours: 12 }, adminId);
    expect(set.settings.params).toEqual({ minEpisodeHours: 12, flipWithinHours: 72, perCoin: { BTCUSDT: { enabled: true, floorPer8h: 0.0005 } } });
    const back = await adm.patch({ perCoin: { BTCUSDT: { enabled: false, floorPer8h: null } } }, adminId);
    expect(back.settings.params.perCoin).toEqual({ BTCUSDT: { enabled: false } });
    expect(back.settings.params.minEpisodeHours).toBe(12);
    await expect(adm.patch({ perCoin: { SOLUSDT: { enabled: true, floorPer8h: null } } }, adminId)).rejects.toBeInstanceOf(FundingAlertsAdminNotListed);
    const on = await adm.patch({ enabled: true }, adminId);
    expect(on.settings.enabled).toBe(true);
    expect((await db.query<{ updated_by: number }>(`select updated_by from alert_type_settings where type = 'funding'`))[0]?.updated_by).toBe(adminId);
    await adm.patch({ enabled: false, minEpisodeHours: 24, perCoin: { BTCUSDT: { enabled: true, floorPer8h: null } } }, adminId);
  });

  it('undo removes the funding rows, the state, the column and the settings row; 034 re-applies', async () => {
    await runMigrations({ connectionString: url, target: '033' });
    expect(await db.query(`select 1 from market_alerts where type = 'funding'`)).toEqual([]);
    expect(await db.query(`select 1 from alert_type_settings where type = 'funding'`)).toEqual([]);
    expect(await fails('select 1 from alert_funding_state')).toMatch(/does not exist/);
    expect(await fails('select funding_alerts from users')).toMatch(/does not exist/);
    await runMigrations({ connectionString: url });
    expect(await db.query(`select params from alert_type_settings where type = 'funding'`)).toEqual([{ params: FUNDING_DEFAULT_PARAMS }]);
  });
});

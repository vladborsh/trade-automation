import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { LEVEL_DEFAULT_PARAMS, WebLevelAlertRowSchema, customLevelDedupeKey } from '@trade-automation/contracts';
import { CustomLevels } from '../../src/alerts/levels/custom-levels';
import { customLevelAlerts } from '../../src/alerts/levels/custom-level-step';
import { PgCustomLevelStore } from '../../src/alerts/levels/pg/custom-levels.repo';
import { PgLevelAlertStore } from '../../src/alerts/levels/pg/level-alerts.repo';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-128 — migration 036 on a database at 035 that holds an admin (level_alerts on) and a member (turned on by hand):
 * - `alert_custom_levels`: the price, note and switches' checks; soft delete;
 * - the store against real rows: a coin must be listed, the per-coin cap, a deleted level leaves `active()`, ticker
 *   resolution by base or symbol, recipients are ADMINS only;
 * - a custom level's alert through the level store's one commit: the once-key per (level, event, UTC day) absorbs a
 *   repeat that day and not the next; the journal page names the level;
 * - undo removes the table and the custom levels' journal rows (not the built-in kinds'); 036 re-applies.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-036.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DAY = 86_400_000;
const BAR = Date.UTC(2026, 10, 11, 10, 0);
const NOW = BAR + 900_000 + 5_000;

maybeDescribe('IB-128 migration 036: custom levels', () => {
  let name: string;
  let url: string;
  let admin: Client;
  let db: PgDatabase;
  let adminId: number;
  let memberId: number;

  const fails = async (sql: string, params: unknown[] = []): Promise<string> => {
    try {
      await db.query(sql, params);
      return 'accepted';
    } catch (e) {
      return (e as Error).message;
    }
  };

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m036', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '035' });
    db = new PgDatabase(url);
    const [a] = await db.query<{ id: number }>(`insert into users (tg_user_id, chat_id, role, lang, level_alerts) values (1, 1001, 'admin', 'en', true) returning id`);
    adminId = a.id;
    const [m] = await db.query<{ id: number }>(`insert into users (tg_user_id, chat_id, role, level_alerts) values (2, 1002, 'member', true) returning id`);
    memberId = m.id;
    await db.query(`delete from alert_symbols where symbol not in ('BTCUSDT', 'TRXUSDT')`);
    await runMigrations({ connectionString: url });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('the table refuses a non-positive or infinite price, an empty or long note, non-object switches, a bad symbol', async () => {
    const ins = (cols: string) => `insert into alert_custom_levels (symbol, price, note, events) values (${cols})`;
    expect(await fails(ins(`'BTCUSDT', 0, null, '{}'`))).toMatch(/check constraint/);
    expect(await fails(ins(`'BTCUSDT', 'Infinity', null, '{}'`))).toMatch(/check constraint/);
    expect(await fails(ins(`'BTCUSDT', 1, '', '{}'`))).toMatch(/check constraint/);
    expect(await fails(ins(`'BTCUSDT', 1, repeat('x', 201), '{}'`))).toMatch(/check constraint/);
    expect(await fails(ins(`'BTCUSDT', 1, null, '[]'`))).toMatch(/check constraint/);
    expect(await fails(ins(`'btc', 1, null, '{}'`))).toMatch(/check constraint/);
    expect(await fails(ins(`'BTCUSDT', 1, repeat('x', 200), '{"sweep_above": false}'`))).toBe('accepted');
    await db.query('delete from alert_custom_levels');
  });

  it('the store: listed coins only, the cap, soft delete, switches, ticker by base or symbol, admins as recipients', async () => {
    const store = new PgCustomLevelStore(db);
    const svc = new CustomLevels(store);
    expect(await store.resolveSymbol('btc')).toEqual({ symbol: 'BTCUSDT', base: 'BTC' });
    expect(await store.resolveSymbol('TRXUSDT')).toEqual({ symbol: 'TRXUSDT', base: 'TRX' });
    expect(await store.resolveSymbol('DOGE')).toBeNull();

    const a = await svc.add({ symbol: 'BTCUSDT', price: 72_000, note: 'range high' }, adminId);
    const b = await svc.add({ symbol: 'BTCUSDT', price: 65_000, events: { sweep_below: false } }, adminId);
    await expect(svc.add({ symbol: 'ETHUSDT', price: 1 }, adminId)).rejects.toMatchObject({ reason: 'not_listed' });
    expect((await store.active()).map((l) => [l.price, l.note, l.events, l.createdBy])).toEqual([
      [65_000, null, { sweep_below: false }, adminId], [72_000, 'range high', {}, adminId],
    ]);
    await svc.setEvents(b.id, { sweep_below: true, breakout_up: false });
    expect((await store.get(b.id))?.events).toEqual({ breakout_up: false });

    await svc.remove(a.id, adminId);
    expect((await store.active()).map((l) => l.id)).toEqual([b.id]);
    expect(await db.query('select deleted_by, deleted_at is not null as gone from alert_custom_levels where id = $1', [a.id])).toEqual([{ deleted_by: adminId, gone: true }]);
    await expect(svc.remove(a.id, adminId)).rejects.toMatchObject({ reason: 'not_found' });
    expect((await svc.chart('BTCUSDT')).levels.map((l) => l.id)).toEqual([b.id]);

    // the cap counts ACTIVE levels: 19 more fill BTC, the deleted one does not count
    for (let i = 0; i < 19; i++) await svc.add({ symbol: 'BTCUSDT', price: 100 + i }, adminId);
    await expect(svc.add({ symbol: 'BTCUSDT', price: 99 }, adminId)).rejects.toMatchObject({ reason: 'too_many' });
    await svc.add({ symbol: 'TRXUSDT', price: 0.3 }, adminId);

    // the member has level_alerts on, and still hears nothing about the owner's levels
    expect(await store.recipients()).toEqual([{ chatId: 1001, lang: 'en' }]);
    expect(memberId).toBeGreaterThan(adminId);
    await db.query('delete from alert_custom_levels');
  });

  it('a custom alert through the level store\'s commit: once per (level, event, UTC day); the journal names the level', async () => {
    const store = new PgCustomLevelStore(db);
    const levels = new PgLevelAlertStore(db);
    const level = await new CustomLevels(store).add({ symbol: 'BTCUSDT', price: 100 }, adminId);
    const at = (open: number) => customLevelAlerts('BTCUSDT', [{ ...level, createdAtMs: 0 }], { openMs: open, open: 99, high: 101, low: 98, close: 100.5 }, 99, false);
    const commit = (open: number) => levels.commit({ source: 'live', build: 'dev', params: LEVEL_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol: 'BTCUSDT', states: [], alerts: at(open) });
    const [id] = await commit(BAR);
    expect(typeof id).toBe('number');
    expect(await commit(BAR + 3_600_000)).toEqual([null]); // later the same UTC day
    const [tomorrow] = await commit(BAR + DAY);
    expect(typeof tomorrow).toBe('number');
    const [row] = await db.query<{ dedupe_key: string; tf: string; direction: string }>('select dedupe_key, tf, direction from market_alerts where id = $1', [id]);
    expect(row).toEqual({ dedupe_key: customLevelDedupeKey('BTCUSDT', level.id, Date.UTC(2026, 10, 11), 'breakout_up'), tf: '15m', direction: 'bullish' });
    const page = await levels.journalPage();
    expect(page.map((r) => WebLevelAlertRowSchema.parse(r)).find((r) => r.id === id)).toMatchObject({ kind: 'custom', customLevelId: level.id, price: 100, close: 100.5 });
  });

  it('undo: the table and the custom levels\' journal rows go, a built-in level\'s row stays; 036 re-applies', async () => {
    const levels = new PgLevelAlertStore(db);
    const details = { kind: 'PWH', price: 100, periodStartMs: 0, periodEndMs: 1, bar: { openMs: BAR, open: 99, high: 102, low: 98, close: 101 }, prevClose: 99, firstBeyondAtMs: null };
    await levels.commit({
      source: 'live', build: 'dev', params: LEVEL_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol: 'BTCUSDT', states: [],
      alerts: [{ event: 'breakout_up', symbol: 'BTCUSDT', direction: 'bullish', atMs: BAR, late: false, details, dedupeKey: 'builtin-pwh' }],
    });
    await runMigrations({ connectionString: url, target: '035' });
    expect(await db.query(`select to_regclass('alert_custom_levels') as t`)).toEqual([{ t: null }]);
    expect((await db.query<{ k: string }>(`select details ->> 'kind' as k from market_alerts where type = 'level' order by id`)).map((r) => r.k)).toEqual(['PWH']);
    await runMigrations({ connectionString: url });
    expect(await db.query(`select count(*)::int as n from alert_custom_levels`)).toEqual([{ n: 0 }]);
  });
});

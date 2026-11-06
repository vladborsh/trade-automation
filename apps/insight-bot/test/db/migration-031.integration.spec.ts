import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { LIQ_DEFAULT_PARAMS } from '@trade-automation/contracts';
import { LiqAlertsAdmin, LiqAlertsAdminNotListed } from '../../src/alerts/liquidations/liq-alerts-admin';
import { PgLiqAlertStore, PgLiqAlertsVisibility } from '../../src/alerts/liquidations/pg/liq-alerts.repo';
import { PgOiAlertStore } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import { LiquidationTracking } from '../../src/collectors/liquidation-tracking/pg/liquidation-tracking.repo';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-122 — migration 031 on a database at 030 that holds an admin, a member and the universe: the
 * per-type settings row with the L4 defaults (equal to the contracts'), `liq_alerts` on for the admin
 * only, the journal's once-key and refusals, the paths' five-subject check, the coverage seed. Then the
 * loop's store against real rows: COIN-M excluded in the query, the running sum's crossing, the
 * footnote, recipients, paths the shared measurer picks up; the collectors' tracked set; undo and redo.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-031.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const MIN = 60_000;
const UNIVERSE = [{ id: 'BTCUSDT', base: 'BTC', binance_perp: 'BTCUSDT', bybit_linear: 'BTCUSDT', okx_swap: 'BTC-USDT-SWAP' }];

maybeDescribe('IB-122 migration 031: market alerts, per-type settings, liq recipients', () => {
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
  const alertSql = `insert into market_alerts (type, event, symbol, at, tf, details, params, source, build, confirmed_at, dedupe_key, fired_at, recipients, late)
    values ('liq', 'alert', 'BTCUSDT', now(), '5m', '{}', '{}', $1, 'dev', now(), $2, $3, $4, $5)`;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m031', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '030' });
    db = new PgDatabase(url);
    // what the box holds before 031: the owner, a member, the universe, a live Bybit heartbeat
    const [a] = await db.query<{ id: number }>(`insert into users (tg_user_id, chat_id, role) values (1, 1001, 'admin') returning id`);
    adminId = a.id;
    await db.query(`insert into users (tg_user_id, chat_id, role) values (2, 1002, 'member')`);
    await db.query(
      `insert into symbols (id, base, quote, binance_perp, bybit_linear, okx_swap, listed_perp, active)
       values ('BTCUSDT','BTC','USDT','BTCUSDT','BTCUSDT','BTC-USDT-SWAP','2020-01-01',true), ('HYPEUSDT','HYPE','USDT','HYPEUSDT','HYPEUSDT',null,'2024-01-01',true)`,
    );
    await db.query(`insert into collector_heartbeats (stream, venue, market, first_seen_at, last_seen_at) values ('bybit:allLiquidation', 'bybit', 'perp', $1, now())`, [new Date(NOW - 30 * 24 * 60 * MIN)]);
    await runMigrations({ connectionString: url });
    await new PartitionMaintenanceService(db).ensureRange(new Date(NOW - 2 * 24 * 60 * MIN), new Date(NOW + 24 * 60 * MIN));
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('L4: one liq settings row, both switches OFF, params equal to the contracts\' defaults', async () => {
    // `where type = 'liq'`: the chain runs to the end, and 034 (IB-124) adds the 'funding' row (its own spec)
    const rows = await db.query<{ type: string; enabled: boolean; members_visible: boolean; params: unknown }>(`select type, enabled, members_visible, params from alert_type_settings where type = 'liq'`);
    expect(rows).toEqual([{ type: 'liq', enabled: false, members_visible: false, params: LIQ_DEFAULT_PARAMS }]);
    expect(await new PgLiqAlertsVisibility(db).membersVisible()).toBe(false);
  });

  it('§1 Recipients: liq_alerts on for the admin that existed, off for the member; default false', async () => {
    expect(await db.query('select role, liq_alerts from users order by id')).toEqual([{ role: 'admin', liq_alerts: true }, { role: 'member', liq_alerts: false }]);
    expect(await new PgLiqAlertStore(db).recipients()).toEqual([{ chatId: 1001, lang: 'ru' }]);
  });

  it('L5: the universe is seeded as tracked since the stream was first seen (OKX had no heartbeat: now)', async () => {
    const rows = await db.query<{ venue: string; symbol: string; since: Date }>('select venue, symbol, since from liquidation_tracked order by venue, symbol');
    expect(rows.map((r) => `${r.venue}:${r.symbol}`)).toEqual(['bybit:BTCUSDT', 'bybit:HYPEUSDT', 'okx:BTC-USDT-SWAP']);
    expect(new Date(rows[0].since).getTime()).toBe(NOW - 30 * 24 * 60 * MIN);
    expect(Date.now() - new Date(rows[2].since).getTime()).toBeLessThan(10 * MIN);
  });

  it('C1: once per (source, type, dedupe_key); source and build have no default; a backfill row is never sent', async () => {
    expect(await fails(alertSql, ['live', 'k1', null, 0, false])).toBe('accepted');
    expect(await fails(alertSql, ['live', 'k1', null, 0, false])).toMatch(/market_alerts_once/);
    expect(await fails(alertSql, ['backfill', 'k1', null, 0, false])).toBe('accepted');
    expect(await fails(alertSql, ['backfill', 'k2', new Date(), 0, false])).toMatch(/market_alerts_backfill_unsent/);
    expect(await fails(alertSql, ['backfill', 'k3', null, 0, true])).toMatch(/market_alerts_backfill_unsent/);
    expect(await fails(`insert into market_alerts (type, event, symbol, at, tf, details, params, build, confirmed_at, dedupe_key) values ('liq','alert','X',now(),'5m','{}','{}','dev',now(),'k9')`))
      .toMatch(/null value in column "source"/);
    expect(await fails(`insert into market_alerts (type, event, symbol, at, tf, details, params, source, confirmed_at, dedupe_key) values ('liq','alert','X',now(),'5m','{}','{}','live',now(),'k9')`))
      .toMatch(/null value in column "build"/);
    expect(await fails(`insert into market_alert_controls (type, kind, symbol, at, details, params, source, build, dedupe_key) values ('liq','random','X',now(),'{}','{}','live','dev','c1')`)).toBe('accepted');
    expect(await fails(`insert into market_alert_controls (type, kind, symbol, at, details, params, source, build, dedupe_key) values ('liq','random','X',now(),'{}','{}','live','dev','c1')`)).toMatch(/market_alert_controls_once/);
    await db.query('delete from market_alerts');
    await db.query('delete from market_alert_controls');
  });

  it('paths: exactly one of FIVE subjects; a market alert gets 4h/24h/72h, and the shared measurer queues them as live', async () => {
    const store = new PgLiqAlertStore(db);
    const id = await store.insertAlert({
      source: 'live', event: 'alert', symbol: 'BTCUSDT', atMs: NOW - 4 * 24 * 60 * MIN, details: { side: 'long', windowStartMs: 0, thresholdUsd: 5e6 }, params: LIQ_DEFAULT_PARAMS,
      build: 'dev', confirmedAtMs: NOW, late: false, dedupeKey: 'liq:paths',
    }) as number;
    const cid = await store.insertControl({ source: 'live', kind: 'near_miss', symbol: 'BTCUSDT', atMs: NOW, details: {}, params: LIQ_DEFAULT_PARAMS, build: 'dev', dedupeKey: 'liq-nm:paths' }) as number;
    await store.insertPaths({ marketAlertId: id }, 'BTCUSDT', (NOW - 4 * 24 * 60 * MIN) / 1000);
    await store.insertPaths({ marketAlertId: id }, 'BTCUSDT', (NOW - 4 * 24 * 60 * MIN) / 1000); // once
    await store.insertPaths({ marketControlId: cid }, 'BTCUSDT', NOW / 1000);
    expect(await db.query('select win, direction, stop_price, atr14 from oi_divergence_paths where market_alert_id = $1 order by win', [id]))
      .toEqual([{ win: '24h', direction: null, stop_price: null, atr14: 0 }, { win: '4h', direction: null, stop_price: null, atr14: 0 }, { win: '72h', direction: null, stop_price: null, atr14: 0 }]);
    expect(await fails(`insert into oi_divergence_paths (market_alert_id, market_control_id, win, symbol, t0, atr14) values ($1, $2, '4h', 'BTCUSDT', now() - (extract(epoch from now())::bigint % 300) * interval '1 second', 0)`, [id, cid]))
      .toMatch(/oi_divergence_paths_subject/);
    const due = await new PgOiAlertStore(db).pathsDue('live', NOW / 1000, 10, 900);
    expect(due.map((d) => d.win).sort()).toEqual(['24h', '4h', '72h']); // closed by NOW; the control's are not yet
    expect(await new PgOiAlertStore(db).pathsDue('backfill', NOW / 1000, 10, 900)).toEqual([]);
  });

  it('the tape read excludes COIN-M even when asked for it by name, and sums only the pairs given', async () => {
    const row = (venue: string, symbol: string, ms: number, side: 'long' | 'short', notional: number): t.LiquidationRow =>
      ({ venue, symbol, ts: new Date(ms), side, price: 100, qty: notional / 100, notional, source: 'ws' });
    await new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple).write([
      row('binance', 'BTCUSDT', NOW - 4 * MIN, 'long', 2e6),
      row('bybit', 'BTCUSDT', NOW - 3 * MIN, 'long', 2e6),
      row('okx', 'BTC-USDT-SWAP', NOW - 2 * MIN, 'long', 2e6),
      row('okx', 'BTC-USDT-SWAP', NOW - MIN, 'short', 9e6),
      row('binance', 'BTCUSD_PERP', NOW - 2 * MIN, 'long', 7.58e8), // IB-BUG-039: ~758× mis-priced
      row('binance', 'ETHUSDT', NOW - 2 * MIN, 'long', 1e6),
    ]);
    const store = new PgLiqAlertStore(db);
    const pairs = [{ venue: 'binance' as const, symbol: 'BTCUSDT' }, { venue: 'bybit' as const, symbol: 'BTCUSDT' }, { venue: 'okx' as const, symbol: 'BTC-USDT-SWAP' }];
    const prints = await store.prints([...pairs, { venue: 'binance', symbol: 'BTCUSD_PERP' }], NOW - 5 * MIN, NOW);
    expect(prints.map((p) => `${p.venue}:${p.side}:${p.usd}`)).toEqual(['binance:long:2000000', 'bybit:long:2000000', 'okx:long:2000000', 'okx:short:9000000']);
    expect(await store.prints(pairs, NOW - 3 * MIN, NOW - 2 * MIN)).toHaveLength(1); // (from, to]
  });

  it('L3: the footnote is «sent today» only once a fired row carried it; the journal reads back details', async () => {
    const store = new PgLiqAlertStore(db);
    const day = Date.UTC(2026, 10, 5);
    expect(await store.footnoteSent(day)).toBe(false);
    const id = await store.insertAlert({
      source: 'live', event: 'alert', symbol: 'ETHUSDT', atMs: NOW, details: { side: 'short', windowStartMs: NOW - 5 * MIN, thresholdUsd: 3e6, sumUsd: 4e6, binanceFootnote: true },
      params: LIQ_DEFAULT_PARAMS, build: 'dev', confirmedAtMs: NOW, late: false, dedupeKey: 'liq:fn',
    }) as number;
    expect(await store.footnoteSent(day)).toBe(false); // journalled, not sent
    await store.markFired(id, NOW + 1_000, 1);
    expect(await store.footnoteSent(day)).toBe(true);
    expect(await store.footnoteSent(day + 86_400_000)).toBe(false);
    expect((await store.journal('live', NOW - 1)).find((j) => j.id === id)).toEqual({
      id, event: 'alert', symbol: 'ETHUSDT', side: 'short', at: NOW, late: false, windowStartMs: NOW - 5 * MIN, thresholdUsd: 3e6, alertId: null,
      eventAt: null, sentAt: null, settled: null, coins: [], totalUsd: null, mergedInto: null, muted: false,
    });
  });

  it('IB-143: an event row reads back its T0, S, settled and coins; the admin page shows its total and coins, «+» for a joiner', async () => {
    const store = new PgLiqAlertStore(db);
    const coin = (symbol: string) => ({ symbol, crossedAt: NOW, windowStartMs: NOW - 5 * MIN, sumUsd: 6e6, thresholdUsd: 5e6, byVenue: { binance: 6e6, bybit: 0, okx: 0 }, count: 1, largest: { usd: 6e6, venue: 'binance' }, silentVenues: [] });
    const shape = { side: 'long', eventAt: NOW, sentAt: NOW + 3 * MIN, coins: [coin('BTCUSDT'), coin('BNBUSDT')], totalUsd: 12e6, count: 2, largest: { usd: 6e6, venue: 'binance', symbol: 'BTCUSDT' }, binanceFootnote: false };
    const first = await store.insertAlert({
      source: 'live', event: 'event', symbol: 'BTCUSDT', atMs: NOW + 3 * MIN, details: { ...shape, settled: 'cap' }, params: LIQ_DEFAULT_PARAMS, build: 'dev',
      confirmedAtMs: NOW, late: false, dedupeKey: `liq-ev:long:${NOW}`,
    }) as number;
    await store.insertAlert({
      source: 'live', event: 'event_continuing', symbol: 'BTCUSDT', atMs: NOW + 7 * MIN, params: LIQ_DEFAULT_PARAMS, build: 'dev', confirmedAtMs: NOW, late: false,
      details: { ...shape, closedAt: NOW + 7 * MIN, closedBy: 'quiet', firstMessageId: first, newCoins: ['BNBUSDT'], addedCoins: [], news: true }, dedupeKey: `liq-ev-cont:long:${NOW}`,
    });
    expect((await store.journal('live', NOW)).find((j) => j.id === first)).toMatchObject({ event: 'event', eventAt: NOW, sentAt: NOW + 3 * MIN, settled: 'cap', coins: ['BTCUSDT', 'BNBUSDT'] });
    const page = await store.journalPage();
    expect(page.filter((r) => r.event.startsWith('event')).map((r) => [r.event, r.sumUsd, r.thresholdUsd, r.coins, r.news])).toEqual([
      ['event_continuing', 12e6, null, ['BTCUSDT', '+BNBUSDT'], true], ['event', 12e6, null, ['BTCUSDT', 'BNBUSDT'], true],
    ]);
  });

  it('L5: the collectors track universe ∪ enabled alert coins; a new coin joins with its own since, a removed one leaves', async () => {
    const tracking = new LiquidationTracking(db, UNIVERSE, { warn: () => undefined });
    await db.query(`insert into alert_symbols (symbol, base) values ('DOGEUSDT', 'DOGE') on conflict do nothing`);
    const at = new Date(NOW);
    expect(await tracking.symbols('bybit', at)).toEqual(['BTCUSDT', 'BNBUSDT', 'DOGEUSDT', 'ETHUSDT', 'SOLUSDT', 'TRXUSDT']);
    expect(await tracking.symbols('okx', at)).toContain('TRX-USDT-SWAP');
    const since = async (venue: string, symbol: string) => (await db.query<{ since: Date }>('select since from liquidation_tracked where venue = $1 and symbol = $2', [venue, symbol]))[0]?.since;
    expect(new Date(await since('bybit', 'TRXUSDT') as Date).getTime()).toBe(NOW);
    expect(new Date(await since('bybit', 'BTCUSDT') as Date).getTime()).toBe(NOW - 30 * 24 * 60 * MIN); // kept
    await db.query(`update alert_symbols set enabled = false where symbol = 'DOGEUSDT'`);
    await tracking.symbols('bybit', new Date(NOW + MIN));
    expect(await since('bybit', 'DOGEUSDT')).toBeUndefined();
    expect(await since('bybit', 'HYPEUSDT')).toBeUndefined(); // not in this collector's universe
    expect(new Date(await since('bybit', 'TRXUSDT') as Date).getTime()).toBe(NOW); // not reset
  });

  it('admin: the section lists every alert coin with its threshold; a coin edit merges; an unlisted coin is refused', async () => {
    const adm = new LiqAlertsAdmin(new PgLiqAlertStore(db));
    const page = await adm.page();
    expect(page.coins.find((c) => c.symbol === 'DOGEUSDT')).toEqual({ symbol: 'DOGEUSDT', base: 'DOGE', listed: false, enabled: false, thresholdUsd: null });
    const after = await adm.patch({ enabled: true, perCoin: { TRXUSDT: { enabled: false, thresholdUsd: 250_000 } } }, adminId);
    expect(after.settings.enabled).toBe(true);
    expect(after.settings.params.perCoin.TRXUSDT).toEqual({ enabled: false, thresholdUsd: 250_000 });
    expect(after.settings.params.perCoin.BTCUSDT).toEqual({ enabled: true, thresholdUsd: 5e6 });
    await expect(adm.patch({ perCoin: { XRPUSDT: { enabled: true, thresholdUsd: 1 } } }, adminId)).rejects.toBeInstanceOf(LiqAlertsAdminNotListed);
    expect(page.alerts.length).toBeGreaterThan(0);
  });

  it('undo, then re-apply', async () => {
    await runMigrations({ connectionString: url, target: '030' });
    expect(await db.query(`select to_regclass('market_alerts') as t`)).toEqual([{ t: null }]);
    expect(await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'users' and column_name = 'liq_alerts'`)).toEqual([{ n: 0 }]);
    await runMigrations({ connectionString: url });
    expect(await db.query(`select to_regclass('market_alerts')::text as t`)).toEqual([{ t: 'market_alerts' }]);
  });
});

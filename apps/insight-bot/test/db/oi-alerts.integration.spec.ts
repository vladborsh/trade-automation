import { randomUUID } from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { OI_DIVERGENCE_DEFAULT_PARAMS } from '@trade-automation/contracts';
import { OiAlertLoop } from '../../src/alerts/oi-divergence/oi-alert-loop';
import { PgOiAlertStore, PgOiAlertsVisibility } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import type { Bar } from '../../src/insights/divergence/detector';
import * as users from '../../src/users/pg/users.repo';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-112 against a real, freshly migrated database (migration 025 from IB-109): the store's SQL
 * against the real constraints, **the default that Telegram ships OFF** (and members do not see the
 * toggle), and the loop end to end on dev-1's real ETHUSDT 1h divergence — journalled, not sent.
 */
const { DATABASE_URL } = process.env;
const describeDb = DATABASE_URL ? describe : describe.skip;
const F: { bars: Bar[]; oi5m: Array<{ time: number; oi: number }>; expected: { aTime: number; bTime: number } } =
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'binance', 'oi-divergence-ethusdt-1h-bullish.json'), 'utf8'));
const CONFIRMED = 1_792_296_000;

describeDb('IB-112 OI alerts against a real database', () => {
  let admin: Client;
  let db: PgDatabase;
  let name: string;
  let store: PgOiAlertStore;
  let adminId: number;
  let memberId: number;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_oialerts', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    store = new PgOiAlertStore(db);
    adminId = (await users.bootstrapAdmin(db, 111)).id;
    await users.createInvite(db, 'aaaaaaaaaaaaaaaa', adminId, new Date(Date.now() + 86_400_000));
    memberId = ((await users.consumeInvite(db, 'aaaaaaaaaaaaaaaa', 222, 222, new Date())) as { user: { id: number } }).user.id;
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  beforeEach(async () => {
    await db.query('delete from oi_divergence_alerts');
    await db.query('delete from oi_divergence_skips');
    await db.query('update alert_settings set enabled = false, members_visible = false where id = 1');
  });

  it('SHIPS OFF: sending and member visibility are both off on a fresh database, with the V5–V7 params', async () => {
    // read before any test touches the row: beforeEach writes the same values, so check the column defaults too
    const defaults = await db.query<{ column_name: string; column_default: string }>(
      `select column_name, column_default from information_schema.columns where table_name = 'alert_settings' and column_name in ('enabled', 'members_visible') order by column_name`,
    );
    expect(defaults).toEqual([{ column_name: 'enabled', column_default: 'false' }, { column_name: 'members_visible', column_default: 'false' }]);
    const s = await store.settings();
    expect(s).toMatchObject({ enabled: false, membersVisible: false, params: OI_DIVERGENCE_DEFAULT_PARAMS });
    expect(await new PgOiAlertsVisibility(db).membersVisible()).toBe(false);
    expect(await store.enabledSymbols()).toEqual(['BNBUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TRXUSDT']);
  });

  it('the loop on the real ETHUSDT divergence: journalled once with its params, nothing sent while off; a re-run adds nothing', async () => {
    const sent: number[] = [];
    const loop = new OiAlertLoop({
      store,
      klines: async (_s, tf, from, to) => (tf === '1h' ? F.bars.filter((b) => b.time >= from && b.time < to) : []),
      oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to), venueSilent: [] }),
      closeAt: async () => null,
      send: async (chatId) => { sent.push(chatId); return true; },
      webBaseUrl: 'https://box.example',
    });
    await db.query(`update alert_symbols set enabled = (symbol = 'ETHUSDT')`);
    try {
      expect(await loop.evaluate('1h', CONFIRMED, CONFIRMED + 360)).toMatchObject({ journalled: 1, sent: 0 });
      expect(await loop.evaluate('1h', CONFIRMED, CONFIRMED + 420)).toMatchObject({ journalled: 0 });
      const rows = await store.recentAlerts();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ symbol: 'ETHUSDT', tf: '1h', direction: 'bullish', late: false, firedAt: null, recipients: 0, runOf: null, runLength: 2, confirmedAt: CONFIRMED, params: OI_DIVERGENCE_DEFAULT_PARAMS });
      expect([rows[0]?.a.time, rows[0]?.b.time]).toEqual([F.expected.aTime, F.expected.bTime]);
      expect(sent).toEqual([]);
    } finally {
      await db.query('update alert_symbols set enabled = true');
    }
  });

  it('the once-keys hold in the database itself (V8): the same alert and the same skip are refused the second time', async () => {
    const row = {
      symbol: 'TRXUSDT', tf: '15m' as const, direction: 'bearish' as const,
      a: { time: 1_000, price: 0.3, oiTime: 1_300, oi: 10 }, b: { time: 9_000, price: 0.31, oiTime: 9_300, oi: 9 },
      runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt: 20_000, late: false,
    };
    const id = await store.insertAlert(row);
    expect(id).not.toBeNull();
    expect(await store.insertAlert(row)).toBeNull();
    expect(await store.runFirstId('TRXUSDT', '15m', 'bearish', 9_000)).toBe(id);
    const repeat = await store.insertAlert({ ...row, b: { ...row.b, time: 12_000 }, runOf: id, runLength: 3 });
    expect((await store.recentAlerts())[0]).toMatchObject({ id: repeat, runOf: id, runLength: 3 });
    const skip = { symbol: 'TRXUSDT', tf: '1h' as const, barTime: 7_200, holeFrom: 3_600, holeTo: 3_900, at: 8_000 };
    expect(await store.insertSkip(skip)).toBe(true);
    expect(await store.insertSkip({ ...skip, at: 9_000 })).toBe(false);
    expect(await store.recentSkips()).toEqual([{ symbol: 'TRXUSDT', tf: '1h', barTime: 7_200, reason: 'no_oi_data', holeFrom: 3_600, holeTo: 3_900, at: 8_000 }]);
  });

  it('recipients (V13): oi_alerts on, not disabled, chat known — in their language', async () => {
    await db.query('update users set oi_alerts = (id = $1)', [memberId]);
    try {
      expect(await store.recipients()).toEqual([{ userId: memberId, chatId: 222, lang: 'ru' }]);
      await db.query('update users set disabled = true where id = $1', [memberId]);
      expect(await store.recipients()).toEqual([]);
    } finally {
      await db.query('update users set disabled = false, oi_alerts = (role = \'admin\')');
    }
  });

  it('outcomes: due only for sent rows, +4 h and +24 h each when due; outcome_at once both are in', async () => {
    const fired = 100_000;
    const id = (await store.insertAlert({
      symbol: 'BTCUSDT', tf: '1h', direction: 'bullish', a: { time: 1, price: 1, oiTime: 1, oi: 1 }, b: { time: 2, price: 1, oiTime: 2, oi: 2 },
      runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt: fired - 360, late: false,
    })) as number;
    expect(await store.outcomesDue(fired + 5 * 3_600)).toEqual([]); // not sent: no outcome
    await store.markFired(id, fired, 1, 50_000);
    expect(await store.outcomesDue(fired + 3 * 3_600)).toEqual([]);
    expect(await store.outcomesDue(fired + 5 * 3_600)).toEqual([{ id, symbol: 'BTCUSDT', firedAt: fired, price4h: null, price24h: null }]);
    await store.setOutcome(id, 'price_4h', 51_000, null);
    expect(await store.outcomesDue(fired + 5 * 3_600)).toEqual([]);
    await store.setOutcome(id, 'price_24h', 49_000, fired + 25 * 3_600);
    expect((await store.recentAlerts())[0]).toMatchObject({ priceAtFire: 50_000, price4h: 51_000, price24h: 49_000, outcomeAt: fired + 25 * 3_600 });
    expect(await store.outcomesDue(fired + 30 * 3_600)).toEqual([]);
  });

  it('the admin side: add (once), pause, remove; settings patch keeps what it is not given and stamps who', async () => {
    expect(await store.addSymbol('DOGEUSDT', 'DOGE', adminId)).toBe(true);
    expect(await store.addSymbol('DOGEUSDT', 'DOGE', adminId)).toBe(false);
    expect(await store.setSymbolEnabled('DOGEUSDT', false)).toBe(true);
    expect((await store.symbols()).find((s) => s.symbol === 'DOGEUSDT')).toMatchObject({ enabled: false, addedBy: adminId });
    expect(await store.enabledSymbols()).not.toContain('DOGEUSDT');
    expect(await store.removeSymbol('DOGEUSDT')).toBe(true);
    expect(await store.removeSymbol('DOGEUSDT')).toBe(false);
    expect(await store.setSymbolEnabled('NOPEUSDT', true)).toBe(false);
    await store.updateSettings({ membersVisible: true }, adminId);
    expect(await store.settings()).toMatchObject({ enabled: false, membersVisible: true, params: OI_DIVERGENCE_DEFAULT_PARAMS, updatedBy: adminId });
    const params = { ...OI_DIVERGENCE_DEFAULT_PARAMS, atrMult: 0.3 };
    await store.updateSettings({ params }, adminId);
    expect(await store.settings()).toMatchObject({ membersVisible: true, params });
    await store.updateSettings({ params: OI_DIVERGENCE_DEFAULT_PARAMS, membersVisible: false }, adminId);
  });
});

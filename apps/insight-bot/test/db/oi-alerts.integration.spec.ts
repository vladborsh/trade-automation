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
    await db.query('delete from oi_divergence_paths');
    await db.query('delete from oi_divergence_controls');
    await db.query('delete from oi_divergence_near_misses');
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
      build: 'dev',
      klines5m: async () => [],
      source: 'live',
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
      source: 'live' as const, symbol: 'TRXUSDT', tf: '15m' as const, direction: 'bearish' as const, kind: 'regular' as const,
      a: { time: 1_000, price: 0.3, oiTime: 1_300, oi: 10 }, b: { time: 9_000, price: 0.31, oiTime: 9_300, oi: 9 },
      runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt: 20_000, late: false, build: 'dev',
    };
    const id = await store.insertAlert(row);
    expect(id).not.toBeNull();
    expect(await store.insertAlert(row)).toBeNull();
    expect(await store.runFirstId('live', 'TRXUSDT', '15m', 'regular', 'bearish', 9_000)).toBe(id);
    const repeat = await store.insertAlert({ ...row, b: { ...row.b, time: 12_000 }, runOf: id, runLength: 3 });
    expect((await store.recentAlerts())[0]).toMatchObject({ id: repeat, runOf: id, runLength: 3 });
    const skip = { symbol: 'TRXUSDT', tf: '1h' as const, barTime: 7_200, holeFrom: 3_600, holeTo: 3_900, at: 8_000 };
    expect(await store.insertSkip(skip)).toBe(true);
    expect(await store.insertSkip({ ...skip, at: 9_000 })).toBe(false);
    expect(await store.recentSkips()).toEqual([{ symbol: 'TRXUSDT', tf: '1h', barTime: 7_200, reason: 'no_oi_data', holeFrom: 3_600, holeTo: 3_900, at: 8_000 }]);
  });

  it('V20 (IB-114): a journal row written before 026 (no tolerances) reads as tolerance 0 through the store; a new row keeps its own', async () => {
    const { priceLineTolAtrMult: _p, oiLineTolMedianMult: _o, ...round1 } = OI_DIVERGENCE_DEFAULT_PARAMS;
    await db.query(
      `insert into oi_divergence_alerts (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, params, confirmed_at, build, source, kind)
       values ('BTCUSDT', '1h', 'bullish', to_timestamp(1000), 100, to_timestamp(1000), 1000, to_timestamp(9000), 98, to_timestamp(9000), 1050, $1, to_timestamp(20000), 'pre-027', 'live', 'regular')`, // 027 stamps such a row (033: regular)
      [JSON.stringify(round1)]);
    await store.insertAlert({
      source: 'live', symbol: 'ETHUSDT', tf: '1h', direction: 'bullish', kind: 'regular' as const, a: { time: 1_000, price: 10, oiTime: 1_000, oi: 5 }, b: { time: 9_000, price: 9, oiTime: 9_000, oi: 6 },
      runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt: 30_000, late: false, build: 'dev',
    });
    const bySymbol = Object.fromEntries((await store.recentAlerts()).map((r) => [r.symbol, r.params]));
    expect(bySymbol.BTCUSDT).toEqual({ ...round1, priceLineTolAtrMult: 0, oiLineTolMedianMult: 0 }); // not the new 0.25 / 0.5
    expect(bySymbol.ETHUSDT).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS);
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
      source: 'live', symbol: 'BTCUSDT', tf: '1h', direction: 'bullish', kind: 'regular' as const, a: { time: 1, price: 1, oiTime: 1, oi: 1 }, b: { time: 2, price: 1, oiTime: 2, oi: 2 },
      runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt: fired - 360, late: false, build: 'dev',
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

  it('IB-113 latestOnTime: the newest on-time alert of the last 24 h on an enabled listed coin — late never, older than 24 h never', async () => {
    const now = 1_800_000_000;
    const H = 3_600;
    const put = (symbol: string, confirmedAt: number, late: boolean, bTime: number) => store.insertAlert({
      source: 'live', symbol, tf: '1h', direction: 'bullish', kind: 'regular' as const, a: { time: bTime - 20 * H, price: 1, oiTime: bTime - 20 * H, oi: 1 },
      b: { time: bTime, price: 0.98, oiTime: bTime, oi: 1.03 }, runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt, late, build: 'dev',
    });
    await put('BTCUSDT', now - 25 * H, false, now - 32 * H); // older than 24 h
    expect(await store.latestOnTime(now)).toBeNull();
    await put('ETHUSDT', now - 2 * H, true, now - 9 * H); // late: never sent, not news
    expect(await store.latestOnTime(now)).toBeNull();
    await put('SOLUSDT', now - 20 * H, false, now - 27 * H);
    await put('BNBUSDT', now - 3 * H, false, now - 10 * H);
    expect((await store.latestOnTime(now))?.symbol).toBe('BNBUSDT'); // two in 24 h → the newest
    await put('TRXUSDT', now + H, false, now - 6 * H); // confirmed after "now": not yet
    expect((await store.latestOnTime(now))?.symbol).toBe('BNBUSDT');
    await db.query(`update alert_symbols set enabled = false where symbol = 'BNBUSDT'`);
    try {
      expect((await store.latestOnTime(now))?.symbol).toBe('SOLUSDT'); // a paused coin is not on the card
    } finally {
      await db.query('update alert_symbols set enabled = true');
    }
  });

  // ------------------------------------------------------------------ IB-115: the research journal

  const nm = (bTime: number) => ({
    source: 'live' as const, symbol: 'ETHUSDT', tf: '1h' as const, direction: 'bullish' as const, kind: 'regular' as const,
    a: { time: bTime - 20 * 3_600, price: 100, oiTime: bTime - 20 * 3_600, oi: 1_000 }, b: { time: bTime, price: 98, oiTime: bTime, oi: 1_010 },
    rule: 'k' as const, miss: 1, unit: 'bars' as const, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt: bTime + 10 * 3_600, build: 'b49cd48d4ab4',
  });

  it('IB-115: the loop writes the build on the journal row and 3 unmeasured paths at t0; the real ETH run records controls with the build', async () => {
    const loop = new OiAlertLoop({
      store,
      klines: async (_s, tf, from, to) => (tf === '1h' ? F.bars.filter((b) => b.time >= from && b.time < to) : []),
      oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to), venueSilent: [] }),
      closeAt: async () => null, send: async () => true, webBaseUrl: '', build: 'b49cd48d4ab4', klines5m: async () => [], source: 'live',
    });
    await db.query(`update alert_symbols set enabled = (symbol = 'ETHUSDT')`);
    try {
      for (let close = (F.bars[184] as Bar).time + 3_600; close <= (F.bars.at(-1) as Bar).time + 3_600; close += 3_600) await loop.evaluate('1h', close, close + 360);
      const [a] = await db.query<{ id: string; build: string }>('select id, build from oi_divergence_alerts', []);
      expect(a.build).toBe('b49cd48d4ab4');
      const paths = await db.query<{ win: string; t0: Date; stop_price: string; measured_at: Date | null }>(
        'select win, t0, stop_price, measured_at from oi_divergence_paths where alert_id = $1 order by win', [a.id]);
      expect(paths.map((p) => [p.win, p.t0.getTime() / 1000, Number(p.stop_price), p.measured_at])).toEqual(
        [['24h', CONFIRMED + 600, 2355, null], ['4h', CONFIRMED + 600, 2355, null], ['72h', CONFIRMED + 600, 2355, null]]);
      const controls = await db.query<{ kind: string; n: number; builds: string[] }>(
        'select kind, count(*)::int n, array_agg(distinct build) builds from oi_divergence_controls group by kind order by kind', []);
      expect(controls.map((c) => c.kind)).toEqual(['pivot', 'random']);
      expect(controls.every((c) => c.n > 0 && c.builds.join() === 'b49cd48d4ab4')).toBe(true);
      const [{ n }] = await db.query<{ n: number }>(
        `select count(*)::int n from oi_divergence_paths p join oi_divergence_controls c on c.id = p.control_id`, []);
      expect(n).toBe(3 * controls.reduce((s, c) => s + c.n, 0));
    } finally {
      await db.query('update alert_symbols set enabled = true');
    }
  });

  it('IB-115: controls and near-misses are once per key; paths once per window', async () => {
    const control = { source: 'live' as const, symbol: 'ETHUSDT', tf: '1h' as const, kind: 'random' as const, direction: null, barTime: 1_792_000_800, stopPrice: null, params: OI_DIVERGENCE_DEFAULT_PARAMS, build: 'dev' };
    const id = await store.insertControl(control);
    expect(id).not.toBeNull();
    expect(await store.insertControl(control)).toBeNull();
    const m = await store.insertNearMiss(nm(1_792_000_800));
    expect(m).not.toBeNull();
    expect(await store.insertNearMiss({ ...nm(1_792_000_800), rule: 'w', miss: 3 })).toBeNull();
    const spec = { symbol: 'ETHUSDT', direction: null, t0: 1_792_004_400 + 600, atr14: 12.5, stopPrice: null };
    await store.insertPaths({ controlId: id as number }, spec);
    await store.insertPaths({ controlId: id as number }, spec);
    await store.insertPaths({ nearMissId: m as number }, { ...spec, direction: 'bullish', stopPrice: 98 });
    const [{ n }] = await db.query<{ n: number }>('select count(*)::int n from oi_divergence_paths', []);
    expect(n).toBe(6);
  });

  it('IB-115: pathsDue — only closed windows (+ 1 min), never-tried before retried, a failed one waits; setPath writes every field once', async () => {
    const id = (await store.insertControl({ source: 'live', symbol: 'BTCUSDT', tf: '1h', kind: 'pivot', direction: 'bullish', barTime: 1_792_000_800, stopPrice: 95, params: OI_DIVERGENCE_DEFAULT_PARAMS, build: 'dev' })) as number;
    const t0 = 1_792_008_000;
    await store.insertPaths({ controlId: id }, { symbol: 'BTCUSDT', direction: 'bullish', t0, atr14: 10, stopPrice: 95 });
    expect(await store.pathsDue('live', t0 + 4 * 3_600 + 59, 10, 900)).toEqual([]);
    const due = await store.pathsDue('live', t0 + 4 * 3_600 + 60, 10, 900);
    expect(due).toEqual([expect.objectContaining({ symbol: 'BTCUSDT', win: '4h', direction: 'bullish', t0, atr14: 10, stopPrice: 95 })]);
    const four = due[0] as { id: number };
    await store.pathFailed(four.id, t0 + 4 * 3_600 + 60);
    expect(await store.pathsDue('live', t0 + 4 * 3_600 + 120, 10, 900)).toEqual([]);
    const later = t0 + 24 * 3_600 + 60;
    expect((await store.pathsDue('live', later, 10, 900)).map((d) => d.win)).toEqual(['24h', '4h']); // the never-tried first
    await store.setPath(four.id, {
      bars: 48, entryAt: t0, entryPrice: 100, high: 106, highAt: t0 + 300, low: 94, lowAt: t0 + 300,
      stopAt: t0 + 300, fav05At: t0 + 300, fav1At: null, fav2At: null, orderAmbiguous: true,
    }, later);
    const [r] = await db.query<Record<string, unknown>>('select bars, entry_price, high, low, stop_at, fav_05_at, fav_1_at, order_ambiguous, measured_at from oi_divergence_paths where id = $1', [four.id]);
    expect([r.bars, Number(r.entry_price), Number(r.high), Number(r.low), (r.stop_at as Date).getTime() / 1000, (r.fav_05_at as Date).getTime() / 1000, r.fav_1_at, r.order_ambiguous, (r.measured_at as Date).getTime() / 1000])
      .toEqual([48, 100, 106, 94, t0 + 300, t0 + 300, null, true, later]);
    expect((await store.pathsDue('live', later, 10, 900)).map((d) => d.win)).toEqual(['24h']);
  });

  it('IB-115 (V27): a journal write without a build is refused by the database (NOT NULL, no default)', async () => {
    const row = {
      source: 'live' as const, symbol: 'TRXUSDT', tf: '15m' as const, direction: 'bearish' as const, kind: 'regular' as const,
      a: { time: 1_000, price: 0.3, oiTime: 1_300, oi: 10 }, b: { time: 9_000, price: 0.31, oiTime: 9_300, oi: 9 },
      runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt: 20_000, late: false,
    };
    await expect(store.insertAlert({ ...row, build: undefined as unknown as string })).rejects.toThrow(/null value in column "build"/);
    await expect(store.insertNearMiss({ ...nm(1_792_000_800), build: undefined as unknown as string })).rejects.toThrow(/null value in column "build"/);
  });
});

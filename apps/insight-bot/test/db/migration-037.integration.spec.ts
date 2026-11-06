import { randomUUID } from 'crypto';
import { Client } from 'pg';
import {
  FUNDING_DEFAULT_PARAMS, LEVEL_DEFAULT_PARAMS, LIQ_DEFAULT_PARAMS, WebFundingAlertRowSchema, WebLevelAlertRowSchema, WebLiqAlertRowSchema,
} from '@trade-automation/contracts';
import { PgFundingAlertStore } from '../../src/alerts/funding/pg/funding-alerts.repo';
import { PgLevelAlertStore } from '../../src/alerts/levels/pg/level-alerts.repo';
import { PgLiqAlertStore } from '../../src/alerts/liquidations/pg/liq-alerts.repo';
import { PgLevelBackfillReads } from '../../src/alerts/liquidations/pg/market-backfill-reads';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-151 — migration 037 (`market_alerts.muted_by`) on a database at 036 that already holds a sent and an unsent row:
 * - the old rows read as unmuted; the column takes only the four switches; a muted row can never be marked sent;
 * - the three stores write `mutedBy` and their journal reads return it (the liq loop's own read as `muted`);
 * - a history run's counts keep muted rows apart (`muted_<event>`), so IB-127's cross-check compares unmuted rows;
 * - undo removes the muted rows and the column; 037 re-applies.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-037.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const BAR = Date.UTC(2026, 10, 11, 10, 0);
const NOW = BAR + 900_000 + 5_000;
const levelDetails = (kind: string) => ({ kind, price: 100, periodStartMs: 0, periodEndMs: 1, bar: { openMs: BAR, open: 99, high: 102, low: 98, close: 101 }, prevClose: 99, firstBeyondAtMs: null });

maybeDescribe('IB-151 migration 037: market_alerts.muted_by', () => {
  let name: string;
  let url: string;
  let admin: Client;
  let db: PgDatabase;
  let sentId: number;
  let unsentId: number;

  const fails = async (sql: string, params: unknown[] = []): Promise<string> => {
    try {
      await db.query(sql, params);
      return 'accepted';
    } catch (e) {
      return (e as Error).message;
    }
  };

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m037', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '036' });
    db = new PgDatabase(url);
    // rows written before 037, by hand (the store names muted_by now): one sent, one journalled only (the type was off)
    const one = async (key: string, kind: string) => Number((await db.query<{ id: string }>(
      `insert into market_alerts (type, event, symbol, direction, at, tf, details, params, source, build, confirmed_at, late, dedupe_key)
       values ('level', 'breakout_up', 'BTCUSDT', 'bullish', $1, '15m', $2, $3, 'live', 'dev', $4, false, $5) returning id`,
      [new Date(BAR), JSON.stringify(levelDetails(kind)), JSON.stringify(LEVEL_DEFAULT_PARAMS), new Date(NOW), key]))[0]?.id);
    sentId = await one('old-sent', 'PWH');
    unsentId = await one('old-unsent', 'PMH');
    await db.query('update market_alerts set fired_at = $2, recipients = 1 where id = $1', [sentId, new Date(NOW)]);
    await runMigrations({ connectionString: url });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('rows written before 037 read as unmuted, sent or not', async () => {
    expect(await db.query('select id, muted_by from market_alerts order by id')).toEqual([{ id: sentId, muted_by: null }, { id: unsentId, muted_by: null }]);
    const page = await new PgLevelAlertStore(db).journalPage();
    expect(page.map((r) => [r.id, r.mutedBy, r.firedAt !== null])).toEqual(expect.arrayContaining([[sentId, null, true], [unsentId, null, false]]));
  });

  it('the column takes only the four switches, and a muted row can never be marked sent', async () => {
    const ins = (mutedBy: string, extra = '') => `insert into market_alerts (type, event, symbol, at, tf, details, params, source, build, confirmed_at, dedupe_key, muted_by${extra ? ', fired_at, recipients' : ''})
      values ('level', 'breakout_up', 'BTCUSDT', now(), '15m', '{}', '{}', 'live', 'dev', now(), '${randomUUID()}', '${mutedBy}'${extra})`;
    expect(await fails(ins('type'))).toMatch(/check constraint/);
    expect(await fails(ins('event', ", now(), 1"))).toMatch(/market_alerts_muted_unsent/);
    for (const by of ['coin', 'daily', 'event', 'custom_event']) expect(await fails(ins(by))).toBe('accepted');
    const [muted] = await db.query<{ id: string }>(`select id from market_alerts where muted_by = 'event' limit 1`);
    await expect(new PgLevelAlertStore(db).markFired(Number(muted?.id), NOW, 2)).rejects.toThrow(/market_alerts_muted_unsent/);
    await db.query(`delete from market_alerts where dedupe_key not like 'old-%'`);
  });

  it('the stores write mutedBy and read it back: the admin pages per type, the liq loop\'s journal as `muted`', async () => {
    const levels = new PgLevelAlertStore(db);
    const [lv] = await levels.commit({
      source: 'live', build: 'dev', params: LEVEL_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol: 'BTCUSDT', states: [],
      alerts: [{ event: 'breakout_down', symbol: 'BTCUSDT', direction: 'bearish', atMs: BAR, late: false, details: levelDetails('WO'), dedupeKey: 'level:wo:muted', mutedBy: 'event' }],
    });
    expect((await levels.journalPage()).map((r) => WebLevelAlertRowSchema.parse(r)).find((r) => r.id === lv)).toMatchObject({ kind: 'WO', mutedBy: 'event', firedAt: null });

    const funding = new PgFundingAlertStore(db);
    const fDetails = { rate: 0.0005, rateTimeMs: NOW, intervalH: 8, ratePer8h: 0.0005, percentile: 0.99, band: { lo: -0.0001, hi: 0.0003 }, floorPer8h: 0.0003, nextFundingTimeMs: NOW, settledCount: 90, side: 'high', episodeStartMs: NOW };
    const [fu] = await funding.commit({
      source: 'live', build: 'dev', params: FUNDING_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol: 'ETHUSDT', states: [],
      alerts: [{ event: 'enter', symbol: 'ETHUSDT', direction: 'bearish', atMs: NOW, details: fDetails, dedupeKey: 'funding:eth:muted', mutedBy: 'coin' }],
    });
    expect((await funding.journalPage()).find((r) => r.id === fu)).toMatchObject({ mutedBy: 'coin', firedAt: null });
    expect(WebFundingAlertRowSchema.shape.mutedBy.parse('coin')).toBe('coin');

    const liq = new PgLiqAlertStore(db);
    const lDetails = { side: 'long', windowStartMs: NOW - 300_000, sumUsd: 9e6, thresholdUsd: 5e6, byVenue: { binance: 9e6, bybit: 0, okx: 0 }, count: 1, largest: { usd: 9e6, venue: 'binance' }, silentVenues: [], binanceFootnote: false };
    const muted = await liq.insertAlert({ source: 'live', event: 'alert', symbol: 'BTCUSDT', atMs: NOW, details: lDetails, params: LIQ_DEFAULT_PARAMS, build: 'dev', confirmedAtMs: NOW, late: false, dedupeKey: 'liq:btc:muted', mutedBy: 'coin' });
    const plain = await liq.insertAlert({ source: 'live', event: 'alert', symbol: 'ETHUSDT', atMs: NOW, details: lDetails, params: LIQ_DEFAULT_PARAMS, build: 'dev', confirmedAtMs: NOW, late: false, dedupeKey: 'liq:eth' });
    const journal = await liq.journal('live', NOW - 1);
    expect(journal.filter((j) => j.id === muted || j.id === plain).map((j) => [j.id, j.muted])).toEqual([[muted, true], [plain, false]]);
    const page = (await liq.journalPage()).map((r) => WebLiqAlertRowSchema.parse(r));
    expect(page.filter((r) => r.id === muted || r.id === plain).map((r) => [r.id, r.mutedBy]).sort()).toEqual([[muted, 'coin'], [plain, null]].sort());
  });

  it('a history run counts muted rows apart: `alerts_<event>` unmuted only, `muted_<event>` the rest', async () => {
    const levels = new PgLevelAlertStore(db);
    await levels.commit({
      source: 'backfill', build: 'dev', params: LEVEL_DEFAULT_PARAMS, confirmedAtMs: NOW, symbol: 'BTCUSDT', states: [],
      alerts: [
        { event: 'breakout_up', symbol: 'BTCUSDT', direction: 'bullish', atMs: BAR, late: false, details: levelDetails('PWH'), dedupeKey: 'bf:pwh' },
        { event: 'breakout_up', symbol: 'BTCUSDT', direction: 'bullish', atMs: BAR, late: false, details: levelDetails('PDH'), dedupeKey: 'bf:pdh:muted', mutedBy: 'daily' },
        { event: 'breakout_down', symbol: 'BTCUSDT', direction: 'bearish', atMs: BAR, late: false, details: levelDetails('WO'), dedupeKey: 'bf:wo:muted', mutedBy: 'event' },
      ],
    });
    const counts = await new PgLevelBackfillReads(db).backfillCounts();
    expect(counts).toMatchObject({ alerts_breakout_up: 1, muted_breakout_up: 1, muted_breakout_down: 1 });
    expect(counts.alerts_breakout_down).toBeUndefined();
  });

  it('undo: the muted rows go, the unmuted stay, the column goes; 037 re-applies', async () => {
    await runMigrations({ connectionString: url, target: '036' });
    const cols = await db.query(`select 1 from information_schema.columns where table_name = 'market_alerts' and column_name = 'muted_by'`);
    expect(cols).toEqual([]);
    const keys = (await db.query<{ dedupe_key: string }>('select dedupe_key from market_alerts order by dedupe_key')).map((r) => r.dedupe_key);
    expect(keys.filter((k) => k.endsWith(':muted'))).toEqual([]);
    expect(keys).toEqual(expect.arrayContaining(['old-sent', 'old-unsent', 'liq:eth', 'bf:pwh']));
    await runMigrations({ connectionString: url });
    expect(await db.query(`select count(*)::int as n from market_alerts where muted_by is not null`)).toEqual([{ n: 0 }]);
  });
});

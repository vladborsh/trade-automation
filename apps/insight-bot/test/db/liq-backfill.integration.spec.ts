import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { LIQ_DEFAULT_PARAMS } from '@trade-automation/contracts';
import { historyStore, replayLiq } from '../../src/alerts/liquidations/backfill/liq-history';
import { PgLiqBackfillReads } from '../../src/alerts/liquidations/pg/liq-backfill-reads';
import { PgLiqAlertStore } from '../../src/alerts/liquidations/pg/liq-alerts.repo';
import { measureBackfillPaths } from '../../src/alerts/oi-divergence/backfill/history-backfill';
import { PgOiAlertStore } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import type { DbHandle } from '../../src/db/db.port';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-123 — the liquidation history run against real SQL (031's keys and checks):
 * - the dry run's transaction rolls back to nothing; the write keeps `source='backfill'` rows, never sent; a
 *   rerun writes 0;
 * - a collector gap older than a day is named `stream_silent` on the alert (the history read), while the live
 *   read (`venueStatus()`) still looks back one day only;
 * - `pathsDue` subjects: IB-116's run (`oi`) never takes a liquidation path and IB-123's (`market`) never takes
 *   an OI one; the live tick (`all`) takes both;
 * - the reads that bound the run: stream starts, live rows before `--until`, the counts, the windows due.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('liq-backfill.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 10, 4); // the first full day
const UNIVERSE = [{ id: 'BTCUSDT', base: 'BTC', binance_perp: 'BTCUSDT', bybit_linear: 'BTCUSDT', okx_swap: 'BTC-USDT-SWAP' }];

maybeDescribe('IB-123 the liquidation history run on real SQL', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_liqbf', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: u.toString() });
    db = new PgDatabase(u.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(T0 - DAY), new Date(T0 + 2 * DAY));
    await db.query(`update alert_type_settings set enabled = true where type = 'liq'`); // the run must ignore it
    for (const [stream, venue, first] of [['binance:forceOrder', 'binance', T0 - 11 * 60 * MIN], ['bybit:allLiquidation', 'bybit', T0 - 11 * 60 * MIN], ['okx:liquidation-orders', 'okx', T0 - 12 * 60 * MIN]] as const) {
      await db.query(`insert into collector_heartbeats (stream, venue, market, first_seen_at, last_seen_at) values ($1, $2, 'perp', $3, now())`, [stream, venue, new Date(first)]);
    }
    await db.query(`insert into liquidation_tracked (venue, symbol, since) values ('bybit', 'BTCUSDT', $1), ('okx', 'BTC-USDT-SWAP', $1)`, [new Date(T0 - DAY)]);
    // an OKX gap 01:00–01:10 on day one: more than a day before the wall clock of any run of this spec
    await db.query(`insert into collector_gaps (stream, venue, gap_from, gap_to, expected, detected_at) values ('okx:liquidation-orders', 'okx', $1, $2, 0, $2)`,
      [new Date(T0 + 60 * MIN), new Date(T0 + 70 * MIN)]);
    const row = (venue: string, symbol: string, ms: number, notional: number): t.LiquidationRow =>
      ({ venue, symbol, ts: new Date(ms), side: 'long', price: 100, qty: notional / 100, notional, source: 'ws' });
    await new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple).write([
      row('binance', 'BTCUSDT', T0 + 62 * MIN, 3e6), row('bybit', 'BTCUSDT', T0 + 63 * MIN, 2.5e6), // 01:03 alert, in the gap
      row('binance', 'BTCUSDT', T0 + 300 * MIN, 6e6), // 05:00 alert, clean
    ]);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const run = (handle: DbHandle) =>
    replayLiq({ store: historyStore(new PgLiqAlertStore(handle), { params: LIQ_DEFAULT_PARAMS, gapsSinceMs: T0 }), universe: UNIVERSE, build: 'dev' }, T0, T0 + 8 * 60 * MIN);

  it('the reads that bound the run: stream starts in LIQ_STREAMS order; live rows at or before --until', async () => {
    const reads = new PgLiqBackfillReads(db);
    expect(await reads.streamStarts()).toEqual([T0 - 11 * 60 * MIN, T0 - 11 * 60 * MIN, T0 - 12 * 60 * MIN]);
    expect(await reads.liveRowsUpTo(T0 + DAY)).toBe(0);
    await db.query(`insert into market_alert_controls (type, kind, symbol, at, details, params, source, build, dedupe_key) values ('liq','random','BTCUSDT',$1,'{}','{}','live','dev','live-ctl')`, [new Date(T0 + DAY)]);
    expect(await reads.liveRowsUpTo(T0 + DAY - 1)).toBe(0);
    expect(await reads.liveRowsUpTo(T0 + DAY)).toBe(1);
    await db.query(`delete from market_alert_controls where dedupe_key = 'live-ctl'`);
  });

  it('dry run: the transaction rolls back to nothing', async () => {
    let inside: Record<string, number> = {};
    await expect(db.transaction(async (tx) => {
      await run(tx);
      inside = await new PgLiqBackfillReads(tx).backfillCounts();
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(inside).toMatchObject({ alerts: 2 });
    expect(await new PgLiqBackfillReads(db).backfillCounts()).toEqual({ alerts: 0, continuations: 0, controls_random: 0, controls_near_miss: 0, paths: 0, paths_measured: 0 });
  });

  it('write: backfill rows, never sent, the old gap named on the 01:03 alert only; a rerun writes 0', async () => {
    const first = await run(db);
    expect(first).toMatchObject({ alerts: 2, warnings: {} });
    const rows = await db.query<{ at: Date; source: string; fired_at: Date | null; recipients: number; late: boolean; details: { silentVenues: unknown[] } }>(
      `select at, source, fired_at, recipients, late, details from market_alerts where type = 'liq' and event = 'alert' order by at`);
    expect(rows.map((r) => [new Date(r.at).getTime(), r.source, r.fired_at, r.recipients, r.late])).toEqual([
      [T0 + 63 * MIN, 'backfill', null, 0, false], [T0 + 300 * MIN, 'backfill', null, 0, false],
    ]);
    expect(rows[0]?.details.silentVenues).toEqual([{ venue: 'okx', reason: 'stream_silent' }]);
    expect(rows[1]?.details.silentVenues).toEqual([]);
    // the live read still looks back one day only: the same gap is not in it
    expect((await new PgLiqAlertStore(db).venueStatus()).gaps).toEqual([]);
    expect((await new PgLiqAlertStore(db).venueStatus(T0)).gaps).toHaveLength(1);

    const before = await new PgLiqBackfillReads(db).backfillCounts();
    expect(await run(db)).toMatchObject({ alerts: 0, continuations: 0, controls: 0 });
    expect(await new PgLiqBackfillReads(db).backfillCounts()).toEqual(before);
  });

  it('pathsDue subjects: oi ↔ market never cross; all takes both; the liq run measures only its own; windows due counted with weight', async () => {
    const oi = await db.query<{ id: string }>(
      `insert into oi_divergence_controls (symbol, tf, kind, bar_time, params, build, source) values ('BTCUSDT', '1h', 'random', $1, '{}', 'dev', 'backfill') returning id`, [new Date(T0)]);
    await db.query(`insert into oi_divergence_paths (control_id, win, symbol, t0, atr14) values ($1, '4h', 'BTCUSDT', $2, 0)`, [oi[0]?.id, new Date(T0)]);
    const store = new PgOiAlertStore(db);
    const now = (T0 + 4 * DAY) / 1000;
    const symbolsOf = async (s: 'all' | 'oi' | 'market') => (await store.pathsDue('backfill', now, 1_000, 900, s)).length;
    const liq = (await new PgLiqBackfillReads(db).backfillCounts()).paths;
    expect(liq).toBeGreaterThan(0);
    expect(await symbolsOf('oi')).toBe(1);
    expect(await symbolsOf('market')).toBe(liq);
    expect(await symbolsOf('all')).toBe(liq + 1);
    expect(await new PgLiqBackfillReads(db).pathsDueNow(T0 + 4 * DAY)).toEqual({ windows: liq, weight: (liq / 3) * 8 });

    const asked: number[] = [];
    const out = await measureBackfillPaths(
      { store, build: 'dev', klines5m: async (_s, from, limit) => { asked.push(limit); return [{ time: from, open: 1, high: 2, low: 0.5, close: 1 }]; } },
      { take: async () => undefined }, () => T0 + 4 * DAY, 50, 'market',
    );
    expect(out).toMatchObject({ measured: liq, failed: 0, weight: (liq / 3) * 8 });
    expect(await symbolsOf('oi')).toBe(1); // IB-116's path untouched
    expect(await new PgLiqBackfillReads(db).unmeasuredPaths()).toEqual({ count: 0, lastCloses: null });
  });
});

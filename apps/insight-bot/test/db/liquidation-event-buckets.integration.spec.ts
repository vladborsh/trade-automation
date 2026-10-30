import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import * as repo from '../../src/web/series/pg/series.repo';
import { floorToGrid, gridOffsetMs, timeframeMs } from '../../src/web/series/range';
import { SeriesController } from '../../src/web/series/series.controller';
import { DB_HOOK_TIMEOUT_MS, dropOwn, dropLeftovers, scratchPrefix } from './scratch-db';

/**
 * IB-068 — the liquidation markers grouped per bar IN POSTGRES, against a real database.
 *
 * The property a fake cannot check: the SQL's floor is the same grid as `floorToGrid`. If they
 * disagreed, a week's bubble would land on a Thursday and miss its candle — the chart would not
 * error, it would just draw the money one bar off.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('liquidation-event-buckets.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MONDAY = Date.UTC(2026, 9, 26); // Mon 26 Oct 2026
const SUNDAY = MONDAY - DAY;
const WEDNESDAY = MONDAY + 2 * DAY;

const row = (venue: string, symbol: string, ms: number, side: 'long' | 'short', price: number, notional: number): t.LiquidationRow =>
  ({ venue, symbol, ts: new Date(ms), side, price, qty: price > 0 ? notional / price : 0, notional, source: 'ws' });

maybeDescribe('IB-068 liquidation events grouped per bar against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_liqbuckets', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(SUNDAY - DAY), new Date(WEDNESDAY + 2 * DAY));

    await db.query(
      `insert into symbols (id, base, quote, binance_perp, binance_spot, bybit_linear, okx_swap, listed_perp, in_signal_set, active, volume_rank)
       values ('BTCUSDT', 'BTC', 'USDT', 'BTCUSDT', 'BTCUSDT', 'BTCUSDT', 'BTC-USDT-SWAP', '2020-01-01', true, true, 1)`,
      [],
    );

    const liq = new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple);
    await liq.write([
      // Sunday: belongs to the PREVIOUS week (Mon 19 Oct), though the epoch grid would put it with Monday
      row('binance', 'BTCUSDT', SUNDAY + 10 * HOUR, 'long', 90, 500),
      // Monday and Wednesday, same week, same side, same venue: one row, VWAP 107.5
      row('binance', 'BTCUSDT', MONDAY + 1 * HOUR, 'long', 100, 1_000),
      row('binance', 'BTCUSDT', WEDNESDAY + 5 * HOUR, 'long', 110, 3_000),
      // same week, other side: its own row
      row('binance', 'BTCUSDT', MONDAY + 2 * HOUR, 'short', 105, 700),
      // same week, same side, other venue — and OKX's own spelling
      row('okx', 'BTC-USDT-SWAP', MONDAY + 3 * HOUR, 'long', 101, 2_000),
      // an hour boundary, exactly: opens the 04:00 bar, not the 03:00 one
      row('bybit', 'BTCUSDT', MONDAY + 4 * HOUR, 'short', 104, 50),
      row('bybit', 'BTCUSDT', MONDAY + 4 * HOUR - 1, 'short', 103, 60),
      // two zero-USD events: the VWAP has nothing to weigh by, so the mean price stands
      row('bybit', 'BTCUSDT', MONDAY + 20 * HOUR, 'long', 200, 0),
      row('bybit', 'BTCUSDT', MONDAY + 20 * HOUR + 1_000, 'long', 210, 0),
    ]);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const buckets = (tf: '1w' | '1h', fromMs = SUNDAY - DAY, toMs = WEDNESDAY + 2 * DAY) =>
    repo.liquidationEventBuckets(db, {
      symbol: 'BTCUSDT', fromMs, toMs, minUsd: 0,
      spanMs: timeframeMs(tf), offsetMs: gridOffsetMs(tf), limit: 1_000,
    });

  it('a 1w bucket opens on MONDAY, matching floorToGrid — Sunday stays in the week before', async () => {
    const rows = await buckets('1w');
    const times = [...new Set(rows.map((r) => r.time))];
    expect(times).toEqual([(MONDAY - 7 * DAY) / 1000, MONDAY / 1000]);
    expect(floorToGrid(SUNDAY + 10 * HOUR, '1w')).toBe(MONDAY - 7 * DAY);
    expect(new Date(MONDAY).getUTCDay()).toBe(1);
  });

  it('sums USD, weights the price by USD, counts events and keeps the largest', async () => {
    const rows = await buckets('1w');
    const binanceLong = rows.find((r) => r.time === MONDAY / 1000 && r.venue === 'binance' && r.side === 'long');
    expect(binanceLong).toEqual({
      time: MONDAY / 1000, side: 'long', venue: 'binance',
      usd: 4_000, price: 107.5, count: 2, maxUsd: 3_000,
    });
    expect(typeof binanceLong?.usd).toBe('number');
  });

  it('splits one bar by side and by venue', async () => {
    const week = (await buckets('1w')).filter((r) => r.time === MONDAY / 1000);
    expect(week.map((r) => `${r.venue}:${r.side}`).sort()).toEqual([
      'binance:long', 'binance:short', 'bybit:long', 'bybit:short', 'okx:long',
    ]);
    expect(week.find((r) => r.venue === 'okx')).toMatchObject({ usd: 2_000, price: 101, count: 1, maxUsd: 2_000 });
  });

  it('every row sits on the floorToGrid bar of every event in it (1h)', async () => {
    const rows = await buckets('1h');
    const bybitShort = rows.filter((r) => r.venue === 'bybit' && r.side === 'short');
    expect(bybitShort.map((r) => r.time)).toEqual([
      floorToGrid(MONDAY + 4 * HOUR - 1, '1h') / 1000,
      floorToGrid(MONDAY + 4 * HOUR, '1h') / 1000,
    ]);
    expect(bybitShort.map((r) => r.count)).toEqual([1, 1]);
  });

  it('zero-USD events fall back to the mean price rather than dividing by zero', async () => {
    const rows = await buckets('1h');
    const zero = rows.find((r) => r.time === (MONDAY + 20 * HOUR) / 1000);
    expect(zero).toMatchObject({ usd: 0, price: 205, count: 2, maxUsd: 0 });
  });

  it('through the controller: tf groups, the shape stays an event, venues come from the rows', async () => {
    const result = await new SeriesController(db)
      .liquidationEvents('BTCUSDT', String(SUNDAY - DAY), String(WEDNESDAY + 2 * DAY), '0', '1w');
    expect(result.events).toHaveLength(6);
    expect(result.venuesPresent).toEqual(['binance', 'bybit', 'okx']);
    expect(result.events.reduce((n, e) => n + (e.count ?? 0), 0)).toBe(9);
  });
});

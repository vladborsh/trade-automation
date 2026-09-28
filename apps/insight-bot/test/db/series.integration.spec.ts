import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { WEB_MAX_POINTS } from '@trade-automation/contracts';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import * as repo from '../../src/web/series/pg/series.repo';
import { strideFor } from '../../src/web/series/range';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-031 — the series reads against a real Postgres, with the thinning done by the database.
 *
 * The property that matters and cannot be checked with a fake: `row_number() % stride` really
 * does return roughly `expected / stride` rows, in order, spanning the whole window. If the
 * stride maths and the SQL disagree, a chart quietly shows a fraction of its range.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('series.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DAY = Date.UTC(2026, 5, 1);
const MIN = 60_000;

maybeDescribe('IB-031 series reads against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_series', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(DAY), new Date(DAY + 2 * 86_400_000));

    // one full day of 1m bars, so the thinning has something real to thin
    const candles = new BatchWriter<t.Candle1mRow>(db, t.CANDLES_1M, t.candle1mTuple);
    await candles.write(Array.from({ length: 1440 }, (_, i) => ({
      venue: 'binance', market: 'perp' as const, symbol: 'BTCUSDT', openTime: new Date(DAY + i * MIN),
      open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1 + i,
      takerBuyVolume: 0.5, source: 'archive' as const,
    })));

    const liq = new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple);
    await liq.write([
      { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(DAY + 30_000), side: 'long', price: 100, qty: 3, notional: 300, source: 'ws' },
      { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(DAY + 45_000), side: 'short', price: 100, qty: 1, notional: 100, source: 'ws' },
      { venue: 'bybit', symbol: 'BTCUSDT', ts: new Date(DAY + 61_000), side: 'long', price: 100, qty: 50, notional: 5000, source: 'ws' },
    ]);

    const oi = new BatchWriter<t.OpenInterestRow>(db, t.OPEN_INTEREST_5M, t.openInterestTuple);
    await oi.write(Array.from({ length: 288 }, (_, i) => ({
      venue: 'binance', symbol: 'BTCUSDT', ts: new Date(DAY + i * 5 * MIN), oiBase: 1000 + i, oiQuote: null, source: 'archive' as const,
    })));

    const funding = new BatchWriter<t.FundingSettlementRow>(db, t.FUNDING_SETTLEMENTS, t.fundingSettlementTuple);
    await funding.write([
      { venue: 'binance', symbol: 'BTCUSDT', fundingTime: new Date(DAY), rate: 0.0001, source: 'archive' },
      { venue: 'bybit', symbol: 'BTCUSDT', fundingTime: new Date(DAY + 8 * 3_600_000), rate: -0.0002, source: 'rest' },
    ]);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('returns every bar when the window fits the cap', async () => {
    const rows = await repo.candles(db, {
      symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 86_400_000, stride: 1,
      venue: 'binance', market: 'perp', timeframe: '1m',
    });
    expect(rows).toHaveLength(1440);
    expect(rows[0].time).toBe(DAY / 1000);
    expect(rows[0].open).toBe(100);
    expect(typeof rows[0].open).toBe('number'); // numeric must not arrive as a string
  });

  it('THINS IN POSTGRES: a stride returns ~n/stride rows and still spans the window', async () => {
    const stride = 10;
    const rows = await repo.candles(db, {
      symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 86_400_000, stride,
      venue: 'binance', market: 'perp', timeframe: '1m',
    });
    expect(rows.length).toBeCloseTo(1440 / stride, -1);
    expect(rows[0].time).toBe(DAY / 1000);
    // the window is still covered: the last kept row is near the end, not near the start
    expect(rows[rows.length - 1].time).toBeGreaterThan((DAY + 23 * 3_600_000) / 1000);
    expect([...rows].sort((a, b) => a.time - b.time)).toEqual(rows);
  });

  it('a 90-day 1m window asks for a stride that brings it under the cap', () => {
    const ninety = 90 * 86_400_000;
    const stride = strideFor(DAY, DAY + ninety, '1m');
    expect(stride).toBeGreaterThan(1);
    expect(Math.ceil(ninety / MIN / stride)).toBeLessThanOrEqual(WEB_MAX_POINTS);
  });

  it('liquidations come back per venue, or summed when no venue is given', async () => {
    const all = await repo.liquidations(db, { symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 3 * MIN, venue: null });
    expect(all).toHaveLength(3);

    const binance = await repo.liquidations(db, { symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 3 * MIN, venue: 'binance' });
    expect(binance).toHaveLength(2);
    expect(binance.every((r) => r.venue === 'binance')).toBe(true);
  });

  it('a liquidation keeps the side that was LIQUIDATED and a usable notional', async () => {
    const rows = await repo.liquidations(db, { symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 3 * MIN, venue: null });
    const long = rows.find((r) => r.notional === 5000);
    expect(long?.side).toBe('long');
    expect(long?.venue).toBe('bybit');
  });

  it('open interest thins on the same rule', async () => {
    const rows = await repo.openInterest(db, { symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 86_400_000, stride: 4, venue: 'binance' });
    expect(rows.length).toBeCloseTo(288 / 4, -1);
    expect(rows[0].value).toBe(1000);
  });

  it('settled funding is returned per venue and in time order', async () => {
    const rows = await repo.settledFunding(db, { symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 86_400_000 });
    expect(rows.map((r) => r.venue)).toEqual(['binance', 'bybit']);
    expect(rows[1].rate).toBe(-0.0002); // the sign is the signal; it must survive the round trip
  });

  it('the picker lists ranked symbols first and reports which venues carry them', async () => {
    await db.query(
      `insert into symbols (id, base, quote, binance_perp, binance_spot, bybit_linear, okx_swap, listed_perp, in_signal_set, active, volume_rank)
       values ('BTCUSDT','BTC','USDT','BTCUSDT','BTCUSDT','BTCUSDT','BTC-USDT-SWAP','2020-01-01',true,true,1),
              ('ZZZUSDT','ZZZ','USDT','ZZZUSDT',null,null,null,'2024-01-01',false,true,null)`,
    );
    const rows = await repo.topSymbols(db, 20);
    expect(rows[0].id).toBe('BTCUSDT');
    expect(rows[0].volumeRank).toBe(1);
    expect(rows[0].binanceSpot).toBe(true);
    // unranked sorts last, and its missing venues are false rather than absent
    expect(rows[rows.length - 1].id).toBe('ZZZUSDT');
    expect(rows[rows.length - 1]).toMatchObject({ volumeRank: null, binanceSpot: false, okxSwap: false });
  });
});

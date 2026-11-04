import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { LiquidationsOverviewService } from '../../src/web/liquidations/overview.service';
import { stubClassifier } from '../web/liquidations-test-classifier';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-BUG-025 — every crypto dollar is in a coin row or in `otherCoins`, on the real SQL map, with
 * the real Binance spellings the box carries (`exchangeInfo-classes.json`, pinned records):
 * BTCUSDC / BTCUSD1 / ETHUSDC / 1000PEPEUSDC belong to their universe coin; HOTUSDT is a coin the
 * universe does not list; SPCXUSD1 is TradFi; DEFIUSDT an index (unknown).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const maybeDescribe = DATABASE_URL ? describe : describe.skip;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'binance', 'exchangeInfo-classes.json'), 'utf8')) as {
  symbols: Array<{ symbol: string; contractType: string; underlyingType: string; baseAsset: string }>;
};
const info = (...names: string[]) => names.map((n) => {
  const s = fixture.symbols.find((x) => x.symbol === n);
  if (!s) throw new Error(`${n} is not in the pinned exchangeInfo fixture`);
  return s;
});

maybeDescribe('IB-BUG-025 coin rows + otherCoins = crypto totals, on the real map', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_othercoins', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(NOW - 40 * 24 * HOUR), new Date(NOW + 24 * HOUR));
    await db.query(
      `insert into symbols (id, base, quote, binance_perp, binance_spot, bybit_linear, okx_swap, listed_perp, in_signal_set, active, volume_rank)
       values ('BTCUSDT','BTC','USDT','BTCUSDT','BTCUSDT','BTCUSDT','BTC-USDT-SWAP','2020-01-01',true,true,1),
              ('ETHUSDT','ETH','USDT','ETHUSDT','ETHUSDT','ETHUSDT','ETH-USDT-SWAP','2020-01-01',true,true,2),
              ('1000PEPEUSDT','PEPE','USDT','1000PEPEUSDT',null,'1000PEPEUSDT','PEPE-USDT-SWAP','2023-05-05',false,true,3),
              ('SOLUSDT','SOL','USDT','SOLUSDT','SOLUSDT','SOLUSDT','SOL-USDT-SWAP','2020-09-14',false,true,4)`,
    );
    const at = (min: number) => new Date(NOW - min * 60_000);
    const row = (symbol: string, side: 'long' | 'short', notional: number, min: number): t.LiquidationRow =>
      ({ venue: 'binance', symbol, ts: at(min), side, price: 1, qty: notional, notional, source: 'ws' });
    await new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple).write([
      row('BTCUSDT', 'long', 100, 50),
      row('BTCUSDC', 'long', 50, 40),        // BTC in another quote
      row('BTCUSD1', 'short', 7, 35),        // and another
      row('ETHUSDC', 'short', 30, 30),
      row('1000PEPEUSDC', 'long', 3, 25),    // 1000-prefix: matches 1000PEPE, never PEPE
      row('SOLUSDT', 'long', 11, 20),        // a universe coin ranked below the shown rows
      row('HOTUSDT', 'short', 20, 15),       // a coin the universe does not list
      row('SPCXUSD1', 'long', 1_000, 10),    // TradFi, in USD1: never an alias, never crypto
      row('DEFIUSDT', 'long', 500, 5),       // an index: unknown
    ]);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const universe = [
    { id: 'BTCUSDT', base: 'BTC' }, { id: 'ETHUSDT', base: 'ETH' }, { id: '1000PEPEUSDT', base: 'PEPE' }, { id: 'SOLUSDT', base: 'SOL' },
  ].map((u) => ({ ...u, asset_class: 'crypto' as const, quote: 'USDT', binance_perp: u.id, listed_perp: '2020-01-01' }));
  const exchangeInfo = info('BTCUSDT', 'ETHUSDT', '1000PEPEUSDT', 'SOLUSDT', 'BTCUSDC', 'BTCUSD1', 'ETHUSDC', '1000PEPEUSDC', 'HOTUSDT', 'SPCXUSD1', 'DEFIUSDT');
  const overview = (binance: Array<{ symbol: string; contractType?: string; underlyingType?: string; baseAsset?: string }> = exchangeInfo) => new LiquidationsOverviewService(db, stubClassifier(universe, binance), () => NOW)
    .overview({ topN: 3, feedMinUsd: 0, feedLimit: 30, period: '1h' as const });
  const sum = (xs: Array<{ totals: { usd: number } }>) => xs.reduce((s, c) => s + c.totals.usd, 0);

  it('another quote of a universe coin is that coin: BTCUSDC + BTCUSD1 in BTC, ETHUSDC in ETH, 1000PEPEUSDC in PEPE', async () => {
    const r = await overview();
    const row = (id: string) => r.block.perCoin.find((c) => c.symbol === id)?.totals.usd;
    expect(r.block.perCoin.map((c) => c.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', '1000PEPEUSDT']);
    expect(row('BTCUSDT')).toBe(100 + 50 + 7);
    expect(row('ETHUSDT')).toBe(30);
    expect(row('1000PEPEUSDT')).toBe(3);
  });

  it('the rest of the crypto is stated, not dropped: rows + otherCoins = totals, to the dollar', async () => {
    const r = await overview();
    expect(r.block.totals.usd).toBe(221);
    expect(r.block.otherCoins).toEqual({ totals: { usd: 31, long: 11, short: 20, events: 2 }, coins: 2 }); // SOL, HOT
    for (const k of ['usd', 'long', 'short', 'events'] as const) {
      expect(r.block.perCoin.reduce((s, c) => s + c.totals[k], 0) + r.block.otherCoins.totals[k]).toBe(r.block.totals[k]);
    }
    expect(r.block.tradfi.usd).toBe(1_000);
    expect(r.block.unknown.usd).toBe(500);
    expect(r.unmappedRows).toBe(1); // HOT: crypto, in no universe coin
  });

  it('without base assets nothing is guessed: the other quotes stay in otherCoins, and the total does not move', async () => {
    const bare = exchangeInfo.map(({ baseAsset: _b, ...rest }) => rest);
    const r = await overview(bare);
    expect(r.block.perCoin.find((c) => c.symbol === 'BTCUSDT')?.totals.usd).toBe(100);
    expect(r.block.otherCoins.totals.usd).toBe(50 + 7 + 30 + 3 + 11 + 20);
    expect(sum(r.block.perCoin) + r.block.otherCoins.totals.usd).toBe(221);
    // one row per liquidation with or without the aliases: the map's join never doubles a row
    expect(r.block.totals.usd).toBe((await overview()).block.totals.usd);
  });
});

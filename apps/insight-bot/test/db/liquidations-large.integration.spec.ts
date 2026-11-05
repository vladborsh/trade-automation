import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { LiquidationsLargeService } from '../../src/web/liquidations/large.service';
import { LiquidationsOverviewService } from '../../src/web/liquidations/overview.service';
import { stubClassifier } from '../web/liquidations-test-classifier';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-120 — `/liquidations/large` against a real Postgres: the population is the Market block's
 * (crypto only, D6; another venue's spelling of a coin is that coin, IB-BUG-011), and a cascade's
 * series spans venues. The service spec fakes the database and cannot see either.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('liquidations-large.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;
const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);

maybeDescribe('IB-120 large liquidations against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_liqlarge', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(NOW - 40 * 24 * 60 * MIN), new Date(NOW + 24 * 60 * MIN));
    await db.query(
      `insert into symbols (id, base, quote, binance_perp, binance_spot, bybit_linear, okx_swap, listed_perp, in_signal_set, active, volume_rank)
       values ('BTCUSDT','BTC','USDT','BTCUSDT','BTCUSDT','BTCUSDT','BTC-USDT-SWAP','2020-01-01',true,true,1),
              ('ETHUSDT','ETH','USDT','ETHUSDT','ETHUSDT','ETHUSDT','ETH-USDT-SWAP','2020-01-01',true,true,2),
              ('XAUUSDT','XAU','USDT','XAUUSDT',null,'XAUUSDT','XAU-USDT-SWAP','2025-12-11',false,true,0)`,
    );
    const row = (venue: string, symbol: string, agoMin: number, side: 'long' | 'short', notional: number): t.LiquidationRow =>
      ({ venue, symbol, ts: new Date(NOW - agoMin * MIN), side, price: 100, qty: notional / 100, notional, source: 'ws' });
    await new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple).write([
      // a BTC short cascade over three venues, 6 minutes first to last; OKX spells the coin its own way
      row('okx', 'BTC-USDT-SWAP', 66, 'short', 2_000_000),
      row('bybit', 'BTCUSDT', 64, 'short', 150_000),
      row('bybit', 'BTCUSDT', 60, 'short', 300_000),
      row('okx', 'BTC-USDT-SWAP', 60, 'short', 120_000),
      row('bybit', 'ETHUSDT', 30, 'long', 400_000),
      // below the page's floor
      row('bybit', 'ETHUSDT', 20, 'long', 90_000),
      // D6: gold, and a coin no universe row or exchangeInfo classes — in no crypto list
      row('bybit', 'XAUUSDT', 10, 'long', 5_000_000),
      row('bybit', 'NEWCOINUSDT', 5, 'short', 700_000),
      // outside 24h, inside 7d
      row('bybit', 'ETHUSDT', 3 * 24 * 60, 'short', 1_500_000),
    ]);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const universe = (['BTC', 'ETH', 'XAU'] as const).map((base) => ({
    id: `${base}USDT`, base, asset_class: base === 'XAU' ? 'tradfi' as const : 'crypto' as const, quote: 'USDT',
    binance_perp: `${base}USDT`, bybit_linear: `${base}USDT`, okx_swap: `${base}-USDT-SWAP`, listed_perp: '2020-01-01',
  }));
  const service = () => {
    const classifier = stubClassifier(universe);
    return new LiquidationsLargeService(db, new LiquidationsOverviewService(db, classifier, () => NOW), () => NOW);
  };
  const all = { symbol: 'all', minUsd: 100_000 as const, side: 'all' as const, venue: 'all' as const };

  it('24h: crypto only, ≥ $100K, newest first, OKX money under the coin\'s id', async () => {
    const a = await service().large({ period: '24h', ...all });
    // newest first; the two BTC rows 60 minutes ago share a timestamp, so their order is not asserted
    expect(a.rows.map((r) => (NOW / 1000 - r.time) / 60)).toEqual([30, 60, 60, 64, 66]);
    expect(a.rows.map((r) => `${r.symbol}:${r.venue}:${r.usd}`).sort()).toEqual([
      'BTCUSDT:bybit:150000', 'BTCUSDT:bybit:300000', 'BTCUSDT:okx:120000', 'BTCUSDT:okx:2000000', 'ETHUSDT:bybit:400000',
    ]);
    expect(a.rows.map((r) => r.symbol)).not.toContain('XAUUSDT');
    expect(a.rows.map((r) => r.symbol)).not.toContain('NEWCOINUSDT');
    expect(a.total).toBe(5);
    expect(a.coins.map((c) => c.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('the cascade is one series across venues: 4 in 6 minutes on every member', async () => {
    const a = await service().large({ period: '24h', ...all, symbol: 'BTCUSDT' });
    expect(a.rows).toHaveLength(4);
    expect(a.rows.every((r) => r.seriesCount === 4 && r.seriesSpanSec === 360)).toBe(true);
    const big = await service().large({ period: '24h', ...all, minUsd: 1_000_000 });
    expect(big.rows.map((r) => [r.usd, r.seriesCount])).toEqual([[2_000_000, 4]]);
  });

  it('7d reaches the older ETH short; 24h does not', async () => {
    const s = service();
    expect((await s.large({ period: '7d', ...all, side: 'short', symbol: 'ETHUSDT' })).rows.map((r) => r.usd)).toEqual([1_500_000]);
    expect((await s.large({ period: '24h', ...all, side: 'short', symbol: 'ETHUSDT' })).total).toBe(0);
  });
});

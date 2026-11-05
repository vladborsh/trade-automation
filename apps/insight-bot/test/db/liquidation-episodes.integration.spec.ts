import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { LiquidationEpisodesService } from '../../src/web/liquidations/episodes.service';
import { LiquidationsOverviewService } from '../../src/web/liquidations/overview.service';
import { stubClassifier } from '../web/liquidations-test-classifier';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-133 — `/liquidations/episodes` against a real Postgres: the Market block's population (crypto
 * only, D6; OKX's spelling is the coin, IB-BUG-011), and COIN-M excluded by the query itself even when
 * the rows are present (IB-BUG-039: a database that missed migration 022). The service spec fakes the
 * database and cannot see any of that.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('liquidation-episodes.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;
const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
const START = NOW - 3 * 24 * 60 * MIN; // 3 days of tape → k = round(7.5 × 3 / 7) = 3

maybeDescribe('IB-133 liquidation episodes against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_liqepis', DATABASE_URL as string);
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
    const row = (venue: string, symbol: string, ms: number, side: 'long' | 'short', notional: number): t.LiquidationRow =>
      ({ venue, symbol, ts: new Date(ms), side, price: 100, qty: notional / 100, notional, source: 'ws' });
    const run = (startMs: number, n: number, usd: number, side: 'long' | 'short', venue = 'binance', symbol = 'BTCUSDT') =>
      Array.from({ length: n }, (_, i) => row(venue, symbol, startMs + i * 30_000, side, usd));
    await new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple).write([
      // every venue's first row, 3 days ago: a venue first seen later would start the window there (norm.ts)
      row('bybit', 'BTCUSDT', START, 'long', 150_000),
      row('okx', 'BTC-USDT-SWAP', START + MIN, 'long', 150_000),
      row('binance', 'BTCUSDT', START + 2 * MIN, 'long', 150_000),
      // A: a BTC short over three venues, $30M; OKX spells the coin its own way
      ...run(NOW - 30 * 60 * MIN, 5, 3_000_000, 'short'),
      ...run(NOW - 30 * 60 * MIN + 10_000, 5, 2_000_000, 'short', 'okx', 'BTC-USDT-SWAP'),
      ...run(NOW - 30 * 60 * MIN + 20_000, 5, 1_000_000, 'short', 'bybit'),
      // B: an ETH long, $20M
      ...run(NOW - 20 * 60 * MIN, 10, 2_000_000, 'long', 'binance', 'ETHUSDT'),
      // C: a BTC short, $12M — the 3rd largest: T
      ...run(NOW - 10 * 60 * MIN, 6, 2_000_000, 'short'),
      // D: $5M, a candidate below T
      ...run(NOW - 5 * 60 * MIN, 5, 1_000_000, 'short'),
      // COIN-M (pre-022 rows, IB-BUG-039 class): $1.4B that would be the norm and the top card
      ...run(NOW - 2 * 60 * MIN, 4, 350_000_000, 'long', 'binance', 'BTCUSD_PERP'),
      row('binance', 'ETHBTC', NOW - 2 * 60 * MIN, 'long', 90_000_000),
      // D6: gold is not in the crypto population
      ...run(NOW - 60 * MIN, 10, 10_000_000, 'long', 'bybit', 'XAUUSDT'),
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
  const service = () => new LiquidationEpisodesService(
    db,
    // the COIN-M symbols are classed crypto here on purpose: only the episode read's own clause keeps them out
    new LiquidationsOverviewService(db, stubClassifier(universe, [
      { symbol: 'BTCUSD_PERP', contractType: 'PERPETUAL', underlyingType: 'COIN', baseAsset: 'BTC' },
      { symbol: 'ETHBTC', contractType: 'PERPETUAL', underlyingType: 'COIN', baseAsset: 'ETH' },
    ]), () => NOW),
    { binancePerp: () => null, closedKlines1m: async () => [] },
    () => NOW,
  );
  const all = { symbol: 'all', minUsd: 100_000 as const, side: 'all' as const, venue: 'all' as const };

  it('3 days held: k = 3, T = $12M; COIN-M and gold are in neither the norm nor the cards', async () => {
    const a = await service().episodes({ period: '7d', ...all });
    expect(a.norm).toEqual({ status: 'ready', thresholdUsd: 12_000_000, heldDays: 3, k: 3, targetPerWeek: 7.5 });
    expect(a.episodes.map((e) => e.usd)).toEqual([30_000_000, 20_000_000, 12_000_000]);
    expect(a.episodes.flatMap((e) => e.coins.map((c) => c.symbol))).not.toContain('BTCUSD_PERP');
    expect(a.episodes.flatMap((e) => e.coins.map((c) => c.symbol))).not.toContain('XAUUSDT');
  });

  it('one cascade across venues is one episode, OKX money under the coin\'s id, shares summing to 100', async () => {
    const a = await service().episodes({ period: '7d', ...all, venue: 'okx' });
    expect(a.episodes).toHaveLength(1);
    const [e] = a.episodes;
    expect([e?.count, e?.coins]).toEqual([15, [{ base: 'BTC', symbol: 'BTCUSDT', usd: 30_000_000 }]]);
    expect(e?.venues).toEqual([{ venue: 'binance', pct: 50 }, { venue: 'okx', pct: 33 }, { venue: 'bybit', pct: 17 }]);
  });
});

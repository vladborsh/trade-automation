import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { LiquidationsOverviewService } from '../../src/web/liquidations/overview.service';
import * as repo from '../../src/web/liquidations/pg/overview.repo';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-038 — the overview SQL against a real Postgres.
 *
 * IB-BUG-005's rule: a spec that fakes the database cannot see a schema drift, and the service
 * spec beside this one deliberately answers every query with nothing. These are the properties
 * only the real thing can show — the venue→coin `union all` map, `floor(epoch/W)*W` alignment,
 * and `numeric` arriving as a string unless every value is converted at the boundary.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('liquidations-overview.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const HOUR = 3_600_000;
/** A fixed "now" on an hour boundary, so the aligned windows are predictable. */
const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);

maybeDescribe('IB-038 liquidations overview against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_liqoverview', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db)
      .ensureRange(new Date(NOW - 40 * 24 * HOUR), new Date(NOW + 24 * HOUR));

    await db.query(
      `insert into symbols (id, base, quote, binance_perp, binance_spot, bybit_linear, okx_swap, listed_perp, in_signal_set, active, volume_rank)
       values ('BTCUSDT','BTC','USDT','BTCUSDT','BTCUSDT','BTCUSDT','BTC-USDT-SWAP','2020-01-01',true,true,1),
              ('ETHUSDT','ETH','USDT','ETHUSDT','ETHUSDT','ETHUSDT','ETH-USDT-SWAP','2020-01-01',true,true,2),
              ('SOLUSDT','SOL','USDT','SOLUSDT','SOLUSDT','SOLUSDT','SOL-USDT-SWAP','2020-09-14',false,true,3)`,
    );

    const liq = new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple);
    const rows: t.LiquidationRow[] = [];

    // Twelve days of history so the 7-day floor is cleared, one BTC long per hour on Bybit.
    for (let h = 12 * 24; h >= 1; h -= 1) {
      rows.push({
        venue: 'bybit', symbol: 'BTCUSDT', ts: new Date(NOW - h * HOUR + 60_000),
        side: 'long', price: 100, qty: 1, notional: 100, source: 'ws',
      });
    }
    // One OKX row at the very start, so OKX spans the norm period for BTC. Without it the §12.4
    // venue-set rule would shorten the period to OKX's age and refuse every BTC ratio — which is
    // correct behaviour, and is pinned separately on ETH below.
    rows.push({
      venue: 'okx', symbol: 'BTC-USDT-SWAP', ts: new Date(NOW - 12 * 24 * HOUR + 30_000),
      side: 'long', price: 100, qty: 0.5, notional: 50, source: 'ws',
    });
    // The trailing hour: a burst, and it is OKX's — under IB-BUG-011's old read it was invisible.
    rows.push({
      venue: 'okx', symbol: 'BTC-USDT-SWAP', ts: new Date(NOW - 30 * 60_000),
      side: 'long', price: 100, qty: 50, notional: 5_000, source: 'ws',
    });
    // ETH: twelve days of Bybit, and an OKX row half an hour old. The venue set changed inside
    // the period, so ETH's ratios must go dark rather than compare two different markets.
    for (let h = 12 * 24; h >= 1; h -= 1) {
      rows.push({
        venue: 'bybit', symbol: 'ETHUSDT', ts: new Date(NOW - h * HOUR + 120_000),
        side: 'short', price: 10, qty: 20, notional: 200, source: 'ws',
      });
    }
    rows.push({
      venue: 'okx', symbol: 'ETH-USDT-SWAP', ts: new Date(NOW - 30 * 60_000),
      side: 'short', price: 10, qty: 100, notional: 1_000, source: 'ws',
    });
    // A symbol no `symbols` row claims: it must reach the market total and no coin's row.
    rows.push({
      venue: 'bybit', symbol: 'NEWCOINUSDT', ts: new Date(NOW - 20 * 60_000),
      side: 'short', price: 1, qty: 7_000, notional: 7_000, source: 'ws',
    });
    await liq.write(rows);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const service = () => new LiquidationsOverviewService(db, () => NOW);

  it('aligns buckets to the epoch and returns numbers, not numeric strings', async () => {
    const buckets = await repo.alignedBuckets(db, { windowSec: 3_600, fromMs: NOW - 3 * HOUR, toMs: NOW });
    expect(buckets.length).toBeGreaterThan(0);
    for (const b of buckets) {
      expect(typeof b.usd).toBe('number');
      expect(b.bucketMs % HOUR).toBe(0); // on the hour, because the epoch is
    }
  });

  it('CANONICALISES ACROSS VENUES: OKX money lands under the Binance-style id', async () => {
    // The last complete hour holds Bybit's 100 (`BTCUSDT`) and OKX's 5 000 (`BTC-USDT-SWAP`).
    // They sum to 5 100 in ONE bucket only if both venue spellings resolved to the same coin —
    // which is the property IB-BUG-011 was about, now asserted on the aggregate path too.
    const buckets = await repo.alignedBuckets(db, { windowSec: 3_600, fromMs: NOW - HOUR, toMs: NOW });
    const btcLong = buckets.filter((b) => b.symbolId === 'BTCUSDT' && b.side === 'long');
    expect(btcLong).toHaveLength(1);
    expect(btcLong[0].usd).toBe(5_100);
  });

  it('leaves an unmapped symbol unattributed rather than dropping it', async () => {
    const buckets = await repo.alignedBuckets(db, { windowSec: 3_600, fromMs: NOW - 2 * HOUR, toMs: NOW });
    expect(buckets.find((b) => b.usd === 7_000)?.symbolId).toBeNull();
  });

  it('the market total includes the unmapped row; the coin row does not', async () => {
    const result = await service().overview({ topN: 20, feedMinUsd: 0, feedLimit: 30 });
    const market1h = result.windows.find((w) => w.window === '1h');
    const btc1h = result.perCoin.find((c) => c.symbol === 'BTCUSDT')?.windows.find((w) => w.window === '1h');

    // BTC: 5 000 OKX burst + 100 Bybit. ETH: 1 000 OKX + 200 Bybit. Plus 7 000 unmapped.
    expect(btc1h?.total.usd).toBe(5_100);
    expect(market1h?.total.usd).toBe(5_100 + 1_200 + 7_000);
    expect(result.unmappedRows).toBe(1);
  });

  it('computes «× от нормы» against the hourly median and states its basis', async () => {
    const result = await service().overview({ topN: 20, feedMinUsd: 0, feedLimit: 30 });
    const btc1h = result.perCoin.find((c) => c.symbol === 'BTCUSDT')?.windows.find((w) => w.window === '1h');

    // Bybit's steady 100/hour is the norm; the trailing hour adds OKX's 5 000 burst.
    expect(btc1h?.long.median).toBe(100);
    expect(btc1h?.long.ratio).toBe(51);
    expect(btc1h?.basis.venues).toEqual(['bybit', 'okx']);
    // the basis reports observed windows, which is what the client renders
    expect(btc1h?.basis.windowsObserved).toBeGreaterThan(0);
    expect(btc1h?.basis.windowsInPeriod).toBeGreaterThanOrEqual(btc1h?.basis.windowsObserved ?? 0);
  });

  it('names Binance as missing because it wrote nothing, not because it is hard-coded', async () => {
    const result = await service().overview({ topN: 20, feedMinUsd: 0, feedLimit: 30 });
    expect(result.venues.present).toEqual(['bybit', 'okx']);
    expect(result.venues.missing).toEqual(['binance']);
  });

  it('the feed is newest-first, above the threshold, and keeps an unmapped event nameable', async () => {
    const result = await service().overview({ topN: 20, feedMinUsd: 1_000, feedLimit: 10 });
    // Above 1 000: the unmapped 7 000 (newest), then the two at -30 min. The hourly 100s and
    // ETH's 200s are below the threshold and must not appear.
    expect(result.feed).toHaveLength(3);
    expect(result.feed[0]).toMatchObject({ symbol: 'NEWCOINUSDT', venue: 'bybit', side: 'short', usd: 7_000 });
    expect(result.feed.map((e) => e.usd).slice(1).sort((a, b) => b - a)).toEqual([5_000, 1_000]);
    expect(result.feed.every((e) => e.usd >= 1_000)).toBe(true);
  });

  it('§12.4: A VENUE JOINING LATE SHORTENS THE PERIOD rather than faking a spike', async () => {
    // ETH has twelve days of Bybit and half an hour of OKX. Comparing an OKX-inclusive hour
    // against a Bybit-only median would read as a surge that is really just a second venue
    // arriving. The period is the span the whole venue set covers, so it collapses and the
    // ratio is refused — with the amounts still reported.
    const result = await service().overview({ topN: 20, feedMinUsd: 0, feedLimit: 30 });
    const eth1h = result.perCoin.find((c) => c.symbol === 'ETHUSDT')?.windows.find((w) => w.window === '1h');

    expect(eth1h?.total.usd).toBe(1_200);
    expect(eth1h?.total.ratio).toBeNull();
    expect(eth1h?.basis.unavailable).toBe('insufficient_history');
    expect(eth1h?.basis.periodDays).toBeLessThan(1);
  });

  it('a coin with no liquidations at all reports amounts of zero and no ratio', async () => {
    const result = await service().overview({ topN: 20, feedMinUsd: 0, feedLimit: 30 });
    const sol = result.perCoin.find((c) => c.symbol === 'SOLUSDT');
    expect(sol).toBeDefined();
    for (const w of sol?.windows ?? []) {
      expect(w.total.usd).toBe(0);
      expect(w.total.ratio).toBeNull();
      expect(w.events).toBe(0);
    }
  });

  it('answers within the §12.3 budget on this tape', async () => {
    const fresh = new LiquidationsOverviewService(db, () => NOW + 1);
    const started = Date.now();
    await fresh.overview({ topN: 20, feedMinUsd: 0, feedLimit: 30 });
    const elapsed = Date.now() - started;
    // §12.3 budgets 50 ms on a day of data; this is twelve days and a cold cache. The assertion
    // is loose on purpose — it is a canary for an accidental per-coin query, not a benchmark.
    expect(elapsed).toBeLessThan(2_000);
  });
});

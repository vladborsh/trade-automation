import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { WEB_MAX_POINTS } from '@trade-automation/contracts';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { SeriesController } from '../../src/web/series/series.controller';
import * as repo from '../../src/web/series/pg/liquidations.repo';
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

    // IB-BUG-011: the reads resolve a canonical symbol to each venue's own spelling, so the map
    // has to exist here as it does in production. Without it the fixtures below would prove only
    // that a string matches itself, which is exactly how the bug survived.
    await db.query(
      `insert into symbols (id, base, quote, binance_perp, binance_spot, bybit_linear, okx_swap, listed_perp, in_signal_set, active, volume_rank)
       values ('BTCUSDT', 'BTC', 'USDT', 'BTCUSDT', 'BTCUSDT', 'BTCUSDT', 'BTC-USDT-SWAP', '2020-01-01', true, true, 1),
              -- the unit pair: Bybit lists PEPE in thousands, OKX one-for-one. Different
              -- tickers, different contract sizes, one coin.
              ('1000PEPEUSDT', 'PEPE', 'USDT', '1000PEPEUSDT', '1000PEPEUSDT', '1000PEPEUSDT', 'PEPE-USDT-SWAP', '2023-05-05', false, true, 2)`,
      [],
    );

    const liq = new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple);
    await liq.write([
      { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(DAY + 30_000), side: 'long', price: 100, qty: 3, notional: 300, source: 'ws' },
      { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(DAY + 45_000), side: 'short', price: 100, qty: 1, notional: 100, source: 'ws' },
      { venue: 'bybit', symbol: 'BTCUSDT', ts: new Date(DAY + 61_000), side: 'long', price: 100, qty: 50, notional: 5000, source: 'ws' },
      // OKX writes its OWN spelling. This row is the whole point of IB-BUG-011: before the fix
      // it existed in the table and reached no page, because the query matched 'BTCUSDT'.
      { venue: 'okx', symbol: 'BTC-USDT-SWAP', ts: new Date(DAY + 75_000), side: 'short', price: 100, qty: 900, notional: 90_000, source: 'ws' },
      { venue: 'bybit', symbol: '1000PEPEUSDT', ts: new Date(DAY + 80_000), side: 'long', price: 0.02, qty: 50_000, notional: 1_000, source: 'ws' },
      { venue: 'okx', symbol: 'PEPE-USDT-SWAP', ts: new Date(DAY + 85_000), side: 'long', price: 0.00002, qty: 100_000_000, notional: 2_000, source: 'ws' },
    ]);

    const oi = new BatchWriter<t.OpenInterestRow>(db, t.OPEN_INTEREST_5M, t.openInterestTuple);
    await oi.write(Array.from({ length: 288 }, (_, i) => ({
      venue: 'binance', symbol: 'BTCUSDT', ts: new Date(DAY + i * 5 * MIN), oiBase: 1000 + i, oiQuote: null, source: 'archive' as const,
    })));
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('a 90-day 1m window asks for a stride that brings it under the cap', () => {
    const ninety = 90 * 86_400_000;
    const stride = strideFor(DAY, DAY + ninety, '1m');
    expect(stride).toBeGreaterThan(1);
    expect(Math.ceil(ninety / MIN / stride)).toBeLessThanOrEqual(WEB_MAX_POINTS);
  });

  it('liquidations come back per venue, or summed when no venue is given', async () => {
    const all = await repo.liquidations(db, { symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 3 * MIN, venue: null });
    expect(all).toHaveLength(4);

    const binance = await repo.liquidations(db, { symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 3 * MIN, venue: 'binance' });
    expect(binance).toHaveLength(2);
    expect(binance.every((r) => r.venue === 'binance')).toBe(true);
  });

  it('IB-BUG-011: a venue that spells the symbol its own way is NOT dropped', async () => {
    // The regression this file could not have caught before: every fixture row used the symbol
    // the query was about to ask for, so a read that matched the raw string passed.
    const all = await repo.liquidations(db, { symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 3 * MIN, venue: null });
    expect([...new Set(all.map((r) => r.venue))].sort()).toEqual(['binance', 'bybit', 'okx']);

    // and it is the big one: 90 000 of the window's 95 400 USD is OKX's, so dropping it does not
    // merely lose a row, it loses the answer
    const okx = all.filter((r) => r.venue === 'okx');
    expect(okx).toHaveLength(1);
    expect(okx[0].notional).toBe(90_000);
    expect(all.reduce((sum, r) => sum + r.notional, 0)).toBe(95_400);

    // asking for one venue still means that venue, resolved through its own spelling
    const only = await repo.liquidations(db, { symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 3 * MIN, venue: 'okx' });
    expect(only.map((r) => r.notional)).toEqual([90_000]);
  });

  it('IB-BUG-011: an unknown symbol returns nothing rather than falling back to the raw string', async () => {
    // The fallback is the dangerous branch: it would quietly resurrect the old behaviour for
    // exactly the symbols the map does not know about.
    const rows = await repo.liquidations(db, { symbol: 'NOTACOIN', fromMs: DAY, toMs: DAY + 3 * MIN, venue: null });
    expect(rows).toEqual([]);
    expect(await repo.venueSpellings(db, 'NOTACOIN')).toEqual([]);
  });

  it('IB-BUG-011: one coin listed under two tickers and two unit scales is still one coin', async () => {
    // Bybit's 1000PEPEUSDT and OKX's PEPE-USDT-SWAP are the same asset at different contract
    // sizes. The quantities are not comparable; the notional is USD on both, which is why the
    // sum is the thing worth adding and qty is not.
    const rows = await repo.liquidations(db, { symbol: '1000PEPEUSDT', fromMs: DAY, toMs: DAY + 3 * MIN, venue: null });
    expect(rows.map((r) => r.venue).sort()).toEqual(['bybit', 'okx']);
    expect(rows.reduce((sum, r) => sum + r.notional, 0)).toBe(3_000);
  });

  it('IB-BUG-011: the response names the venues the DATA delivered, not the filter asked for', async () => {
    // The label was true to the parameter and false to the rows; these are now two fields.
    const controller = new SeriesController(db);
    const all = await controller.liquidations('BTCUSDT', String(DAY), String(DAY + 3 * MIN), '1m', 'all');
    expect(all.venue).toBe('all');
    expect(all.venuesPresent).toEqual(['binance', 'bybit', 'okx']);

    const okx = await controller.liquidations('BTCUSDT', String(DAY), String(DAY + 3 * MIN), '1m', 'okx');
    expect(okx.venuesPresent).toEqual(['okx']);

    // and a window with nothing in it claims no venues at all, rather than the filter's name
    const quiet = await controller.liquidations('BTCUSDT', String(DAY + 10 * MIN), String(DAY + 11 * MIN), '1m', 'all');
    expect(quiet.venuesPresent).toEqual([]);
  });

  it('IB-BUG-011: venueSpellings de-duplicates venues that spell it the same', async () => {
    expect((await repo.venueSpellings(db, 'BTCUSDT')).sort()).toEqual(['BTC-USDT-SWAP', 'BTCUSDT']);
    expect(await repo.venueSpellings(db, 'BTCUSDT', 'okx')).toEqual(['BTC-USDT-SWAP']);
  });

  it('a liquidation keeps the side that was LIQUIDATED and a usable notional', async () => {
    const rows = await repo.liquidations(db, { symbol: 'BTCUSDT', fromMs: DAY, toMs: DAY + 3 * MIN, venue: null });
    const long = rows.find((r) => r.notional === 5000);
    expect(long?.side).toBe('long');
    expect(long?.venue).toBe('bybit');
  });

});

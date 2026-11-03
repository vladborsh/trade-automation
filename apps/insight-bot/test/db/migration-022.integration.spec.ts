import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-BUG-018 — migration 022 deletes exactly the liquidation rows whose notional was never USD
 * (Binance COIN-M perps and quarterlies, BTC-quoted contracts) and nothing else: not the correctly
 * priced USDT quarterlies or stablecoin-margined rows, not OKX or Bybit.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-022.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const TS = new Date(Date.UTC(2026, 10, 3, 1, 0));

maybeDescribe('IB-BUG-018 migration 022 — the mispriced-liquidations repair', () => {
  let name: string;
  let url: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m022', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '021' });
    db = new PgDatabase(url);
    await new PartitionMaintenanceService(db).ensureRange(TS, TS);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('deletes the COIN-M and BTC-quoted Binance rows, and keeps every correctly priced one', async () => {
    const rows: Array<[string, string, number, number]> = [
      // venue, symbol, price, qty — the shapes seen on insight_coord 2026-11-02/03
      ['binance', 'BTCUSD_PERP', 76427, 897], // inverse: 897 USD-100 contracts stored as $68.6M
      ['binance', 'BTCUSD_261225', 77162.3, 6], // inverse quarterly
      ['binance', 'ETHBTC', 0.0295, 7.9], // quoted in BTC
      ['binance', 'BTCUSDT', 76000, 0.5], // kept: USDT-linear
      ['binance', 'BTCUSDT_261225', 77793.5, 0.007], // kept: linear, priced right
      ['binance', 'ETHUSDC', 2300, 1], // kept: linear stablecoin
      ['binance', 'BTCUSD1', 76930, 0.026], // kept: linear stablecoin
      ['okx', 'BTC-USDT-SWAP', 76000, 0.1], // kept
      ['bybit', 'BTCUSDT', 76000, 0.2], // kept
    ];
    for (const [venue, symbol, price, qty] of rows) {
      await db.query(
        `insert into liquidations (venue, symbol, ts, side, price, qty, notional, source) values ($1, $2, $3, 'long', $4, $5, $6, 'ws')`,
        [venue, symbol, TS, price, qty, price * qty],
      );
    }

    await runMigrations({ connectionString: url });

    const left = await db.query<{ v: string }>(`select venue || ':' || symbol as v from liquidations order by 1`);
    expect(left.map((r) => r.v)).toEqual([
      'binance:BTCUSD1', 'binance:BTCUSDT', 'binance:BTCUSDT_261225', 'binance:ETHUSDC', 'bybit:BTCUSDT', 'okx:BTC-USDT-SWAP',
    ]);
  });
});

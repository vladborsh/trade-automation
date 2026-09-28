import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { syncUniverse } from '../../src/db/universe-sync';
import type { UniverseFile } from '../../src/config/universe.schema';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-BUG-005 — the spec that could not have passed.
 *
 * `universe-sync.spec.ts` drives `syncUniverse` against a FAKE db and asserts the INSERT names
 * `coingecko_id`. That is why a missing column stayed green: no migration ever created
 * `symbols.coingecko_id` (IB-031's 008 dropped it believing IB-036's 007 declared it; 007 only
 * mentions it in a comment), so every boot died on the universe sync with
 * `column "coingecko_id" of relation "symbols" does not exist` — on a fresh database as well as a
 * migrated one, and the app never reached `listen`.
 *
 * So this one runs the real thing against a real schema, and — per the Tech Lead's ask — with
 * symbols ALREADY PRESENT, which is the box's second boot and every restart after the first.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('universe-sync.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

function universe(overrides: Partial<UniverseFile> = {}): UniverseFile {
  return {
    signal_set: ['BTCUSDT'],
    symbols: [
      {
        id: 'BTCUSDT', base: 'BTC', quote: 'USDT', binance_perp: 'BTCUSDT', binance_spot: 'BTCUSDT',
        listed_perp: '2020-01-01', volume_rank: 1, coingecko_id: 'bitcoin',
      },
      {
        id: 'ETHUSDT', base: 'ETH', quote: 'USDT', binance_perp: 'ETHUSDT', binance_spot: 'ETHUSDT',
        listed_perp: '2020-01-01', volume_rank: 2, coingecko_id: 'ethereum',
      },
    ],
    ...overrides,
  } as UniverseFile;
}

maybeDescribe('syncUniverse against a real schema (IB-BUG-005)', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_uni', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    db = new PgDatabase(url.toString());
    await runMigrations({ connectionString: url.toString() });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('the migrations give `symbols` every column the sync writes', async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'symbols'`,
    );
    const names = columns.map((c) => c.column_name);
    // the two that collided between IB-031 and IB-036, and were the reason this spec exists
    expect(names).toContain('coingecko_id');
    expect(names).toContain('volume_rank');
  });

  it('syncs a fresh universe, round-tripping coingecko_id', async () => {
    const result = await syncUniverse(db, universe());
    expect(result.upserted).toBe(2);

    const rows = await db.query<{ id: string; coingecko_id: string | null; volume_rank: number | null }>(
      'select id, coingecko_id, volume_rank from symbols order by id',
    );
    expect(rows).toEqual([
      { id: 'BTCUSDT', coingecko_id: 'bitcoin', volume_rank: 1 },
      { id: 'ETHUSDT', coingecko_id: 'ethereum', volume_rank: 2 },
    ]);
  });

  it('syncs again over symbols that are ALREADY PRESENT — the box’s second boot', async () => {
    // the first sync ran in the test above; this is a restart against a populated table
    await expect(syncUniverse(db, universe())).resolves.toMatchObject({ upserted: 2 });

    const [btc] = await db.query<{ coingecko_id: string | null }>(
      "select coingecko_id from symbols where id = 'BTCUSDT'",
    );
    expect(btc.coingecko_id).toBe('bitcoin');
  });

  it('updates a changed coingecko_id rather than leaving the old one', async () => {
    const changed = universe();
    changed.symbols[1] = { ...changed.symbols[1], coingecko_id: 'ethereum-classic' };
    await syncUniverse(db, changed);

    const [eth] = await db.query<{ coingecko_id: string | null }>(
      "select coingecko_id from symbols where id = 'ETHUSDT'",
    );
    expect(eth.coingecko_id).toBe('ethereum-classic');
  });

  it('accepts a symbol CoinGecko does not list, storing null rather than failing the boot', async () => {
    const partial = universe();
    partial.symbols = [{ ...partial.symbols[0], coingecko_id: undefined }] as UniverseFile['symbols'];
    await expect(syncUniverse(db, partial)).resolves.toBeTruthy();

    const [btc] = await db.query<{ coingecko_id: string | null }>(
      "select coingecko_id from symbols where id = 'BTCUSDT'",
    );
    expect(btc.coingecko_id).toBeNull();
  });
});

import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { marketCapSince, recordMarketCap } from '../../src/web/market/pg/market-cap.repo';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-130 — migration 030: BTC and ETH dominance on `market_cap_total`, two nullable percent columns
 * (0..100, no default). Rows written before 030 stay null (nothing backfilled); the alter does not
 * rewrite the table; the read returns both shares with the cap in one query; undo drops the two
 * columns and keeps the cap's history.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-030.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const T0 = Date.UTC(2026, 10, 5, 0);
const STEP = 600_000;

maybeDescribe('IB-130 migration 030: btc_pct / eth_pct on market_cap_total', () => {
  let name: string;
  let url: string;
  let admin: Client;
  let db: PgDatabase;
  /** The table's storage file under 029, before 030 ran: unchanged after 030 means no rewrite. */
  let filenodeAt029: number;

  const fails = async (sql: string, params: unknown[] = []): Promise<string> => {
    try {
      await db.query(sql, params);
      return 'accepted';
    } catch (e) {
      return (e as Error).message;
    }
  };
  const filenode = async () =>
    (await db.query<{ n: number }>(`select relfilenode::int n from pg_class where oid = 'market_cap_total'::regclass`))[0].n;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m030', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '029' });
    db = new PgDatabase(url);
    // a row the cap recorder wrote before 030 reached the database
    await db.query(`insert into market_cap_total (ts, total_usd, fetched_at) values ($1, 2.5e12, $1)`, [new Date(T0 - STEP)]);
    filenodeAt029 = await filenode();
    await runMigrations({ connectionString: url });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('the columns: btc_pct, eth_pct, double precision, nullable, NO default; the alter did not rewrite the table', async () => {
    const cols = await db.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_name = 'market_cap_total' order by ordinal_position`);
    expect(cols.map((c) => c.column_name)).toEqual(['ts', 'total_usd', 'fetched_at', 'btc_pct', 'eth_pct']);
    expect(cols.slice(3)).toEqual([
      { column_name: 'btc_pct', data_type: 'double precision', is_nullable: 'YES', column_default: null },
      { column_name: 'eth_pct', data_type: 'double precision', is_nullable: 'YES', column_default: null },
    ]);
    expect(await filenode()).toBe(filenodeAt029);
  });

  it('the row written before 030 keeps its cap and has null shares (no backfill)', async () => {
    const [old] = await db.query<{ total_usd: string; btc_pct: number | null; eth_pct: number | null }>(
      `select total_usd::text, btc_pct, eth_pct from market_cap_total where ts = $1`, [new Date(T0 - STEP)]);
    expect(old).toEqual({ total_usd: '2500000000000', btc_pct: null, eth_pct: null });
  });

  it('the database refuses a share outside 0..100 in either column; the bounds and null are accepted', async () => {
    let i = 0;
    const ins = (btc: unknown, eth: unknown) => fails(
      `insert into market_cap_total (ts, total_usd, btc_pct, eth_pct, fetched_at) values ($1, 2.6e12, $2, $3, now())`,
      [new Date(T0 + 100 * STEP + (i += 1) * 1000), btc, eth]);
    expect(await ins(100.01, 11)).toMatch(/check constraint "market_cap_total_btc_pct_check"/);
    expect(await ins(-0.01, 11)).toMatch(/check constraint "market_cap_total_btc_pct_check"/);
    expect(await ins(57, 100.01)).toMatch(/check constraint "market_cap_total_eth_pct_check"/);
    expect(await ins(57, -0.01)).toMatch(/check constraint "market_cap_total_eth_pct_check"/);
    expect(await ins(0, 100)).toBe('accepted');
    expect(await ins(null, null)).toBe('accepted');
    await db.query(`delete from market_cap_total where ts > $1`, [new Date(T0 + 99 * STEP)]);
  });

  it('the writer stores both shares; marketCapSince returns them with the cap in the one read, null where absent', async () => {
    await recordMarketCap(db, { tsMs: T0, totalUsd: 2.68e12, btcPct: 57.31, ethPct: 11.42 }, new Date(T0 + 5_000));
    await recordMarketCap(db, { tsMs: T0 + STEP, totalUsd: 2.69e12, btcPct: 57.4, ethPct: null }, new Date(T0 + STEP + 5_000));
    // a second poll of the same refresh: still one row, the first observation standing
    expect(await recordMarketCap(db, { tsMs: T0, totalUsd: 2.68e12, btcPct: 99, ethPct: 99 }, new Date(T0 + STEP))).toBe(false);
    expect(await marketCapSince(db, T0 - 2 * STEP)).toEqual([
      { tsMs: T0 - STEP, totalUsd: 2.5e12, btcPct: null, ethPct: null },
      { tsMs: T0, totalUsd: 2.68e12, btcPct: 57.31, ethPct: 11.42 },
      { tsMs: T0 + STEP, totalUsd: 2.69e12, btcPct: 57.4, ethPct: null },
    ]);
  });

  it('a day of rows (144) with both shares: pg_total_relation_size, measured', async () => {
    await db.query('delete from market_cap_total');
    for (let i = 0; i < 144; i += 1) {
      await recordMarketCap(db, { tsMs: T0 + i * STEP, totalUsd: 2680123456789.12 + i * 1e6, btcPct: 57.3 + i / 1000, ethPct: 11.4 - i / 1000 }, new Date(T0 + i * STEP + 5_000));
    }
    const [s] = await db.query<{ total: number; heap: number; idx: number }>(
      `select pg_total_relation_size('market_cap_total')::int total, pg_relation_size('market_cap_total')::int heap,
              pg_indexes_size('market_cap_total')::int idx`);
    process.stdout.write(`IB-130 market_cap_total after 144 rows with shares: total ${s.total} B (heap ${s.heap}, indexes ${s.idx})\n`);
    expect(s.total).toBeLessThan(128 * 1024);
  });

  it('undo drops both columns and keeps the cap rows; 030 re-applies', async () => {
    await runMigrations({ connectionString: url, target: '029' });
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'market_cap_total' order by ordinal_position`);
    expect(cols.map((c) => c.column_name)).toEqual(['ts', 'total_usd', 'fetched_at']);
    const [n] = await db.query<{ n: number }>('select count(*)::int n from market_cap_total');
    expect(n.n).toBe(144);
    await runMigrations({ connectionString: url });
    expect(await recordMarketCap(db, { tsMs: T0 - 10 * STEP, totalUsd: 1, btcPct: 50, ethPct: 10 }, new Date(T0))).toBe(true);
  }, DB_HOOK_TIMEOUT_MS);
});

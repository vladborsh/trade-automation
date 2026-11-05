import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { marketCapSince, recordMarketCap } from '../../src/web/market/pg/market-cap.repo';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-118 — migration 029: `market_cap_total`, our own record of the total market cap. One row per
 * CoinGecko `updated_at` (the primary key collapses two polls of one refresh), a positive total, no
 * partitions; the old `market_cap_global` stays dropped; undo and re-apply are clean.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-029.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const T0 = Date.UTC(2026, 10, 5, 0);

maybeDescribe('IB-118 migration 029: market_cap_total', () => {
  let name: string;
  let url: string;
  let admin: Client;
  let db: PgDatabase;

  const fails = async (sql: string, params: unknown[] = []): Promise<string> => {
    try {
      await db.query(sql, params);
      return 'accepted';
    } catch (e) {
      return (e as Error).message;
    }
  };

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m029', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '028' });
    db = new PgDatabase(url);
    await runMigrations({ connectionString: url });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  beforeEach(async () => {
    await db.query('delete from market_cap_total');
  });

  it('the table: ts primary key, total_usd numeric NOT NULL, fetched_at NOT NULL; not partitioned; market_cap_global not revived', async () => {
    const cols = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns where table_name = 'market_cap_total' order by ordinal_position`);
    expect(cols).toEqual([
      { column_name: 'ts', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'total_usd', data_type: 'numeric', is_nullable: 'NO' },
      { column_name: 'fetched_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);
    const [pk] = await db.query<{ cols: string }>(
      `select string_agg(a.attname, ',') cols from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = 'market_cap_total'::regclass and i.indisprimary`);
    expect(pk.cols).toBe('ts');
    const [kind] = await db.query<{ relkind: string }>(`select relkind from pg_class where oid = 'market_cap_total'::regclass`);
    expect(kind.relkind).toBe('r'); // an ordinary table, not 'p'
    const [old] = await db.query<{ t: string | null }>(`select to_regclass('public.market_cap_global')::text t`);
    expect(old.t).toBeNull();
  });

  it('the database refuses a zero or negative total, and a missing one', async () => {
    const ins = (v: unknown) => fails(`insert into market_cap_total (ts, total_usd, fetched_at) values (now(), $1, now())`, [v]);
    expect(await ins(0)).toMatch(/check constraint/);
    expect(await ins(-1)).toMatch(/check constraint/);
    expect(await ins(null)).toMatch(/null value/);
    expect(await ins(2.68e12)).toBe('accepted');
  });

  it('two polls of the same CoinGecko refresh are ONE row, the first observation standing', async () => {
    const row = { tsMs: T0, totalUsd: 2.68e12 };
    expect(await recordMarketCap(db, row, new Date(T0 + 60_000))).toBe(true);
    expect(await recordMarketCap(db, row, new Date(T0 + 660_000))).toBe(false);
    const rows = await db.query<{ n: number; fetched: Date }>(`select count(*)::int n, min(fetched_at) fetched from market_cap_total`);
    expect(rows[0]).toEqual({ n: 1, fetched: new Date(T0 + 60_000) });
  });

  it('marketCapSince: rows strictly after the bound, oldest first, as numbers', async () => {
    for (const i of [3, 1, 0, 2]) await recordMarketCap(db, { tsMs: T0 + i * 600_000, totalUsd: 2.6e12 + i }, new Date(T0));
    expect(await marketCapSince(db, T0)).toEqual([1, 2, 3].map((i) => ({ tsMs: T0 + i * 600_000, totalUsd: 2.6e12 + i })));
  });

  it('a day of rows (144, one per 10 min): pg_total_relation_size, measured', async () => {
    for (let i = 0; i < 144; i += 1) await recordMarketCap(db, { tsMs: T0 + i * 600_000, totalUsd: 2680123456789.12 + i * 1e6 }, new Date(T0 + i * 600_000 + 5_000));
    const [s] = await db.query<{ total: number; heap: number; idx: number; fsm: number; vm: number }>(
      `select pg_total_relation_size('market_cap_total')::int total, pg_relation_size('market_cap_total')::int heap,
              pg_indexes_size('market_cap_total')::int idx, pg_relation_size('market_cap_total', 'fsm')::int fsm,
              pg_relation_size('market_cap_total', 'vm')::int vm`);
    process.stdout.write(`IB-118 market_cap_total after 144 rows: total ${s.total} B (heap ${s.heap}, indexes ${s.idx}, fsm ${s.fsm}, vm ${s.vm})\n`);
    // a day is pages, not rows: the heap and the key's index are 8 KiB pages, the free-space map a fixed 24 KiB
    expect(s.total).toBeLessThan(128 * 1024);
  });

  it('undo drops the table; 029 re-applies', async () => {
    await runMigrations({ connectionString: url, target: '028' });
    const [gone] = await db.query<{ t: string | null }>(`select to_regclass('public.market_cap_total')::text t`);
    expect(gone.t).toBeNull();
    await runMigrations({ connectionString: url });
    expect(await recordMarketCap(db, { tsMs: T0, totalUsd: 1 }, new Date(T0))).toBe(true);
  }, DB_HOOK_TIMEOUT_MS);
});

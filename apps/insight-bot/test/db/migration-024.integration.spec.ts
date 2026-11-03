import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { buildCreatePartition, partitionsFor } from '../../src/db/partitions';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * WD-006 — migration 024 drops the 17 retired tables and nothing else. One row is seeded in a KEPT
 * and a DROPPED table of each family on a database at 023. After 024 the dropped tables are gone and
 * the kept rows are untouched. A drop list that grew by one kept table fails here, and so does a
 * migration that drops nothing.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-024.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DROPPED = [
  'candles_1m', 'candles_agg', 'mark_funding_1m', 'funding_settlements', 'gap_reports',
  'fear_greed', 'market_cap_coin', 'market_cap_global',
  'feature_frames', 'feature_frame_versions', 'feature_value_conflicts',
  'playbook_frame_pins', 'playbook_config', 'playbook_evaluations', 'playbook_state', 'signals', 'cooldowns',
];
/** Every table that must survive, from the row and the owner's rulings. */
const KEPT = [
  'liquidations', 'collector_gaps', 'collector_heartbeats', 'symbols', 'open_interest_5m', 'long_short_5m',
  'calendar_events', 'calendar_fetch_runs', 'calendar_notifications_sent',
  'users', 'invites', 'web_login_tokens', 'web_sessions', 'web_credentials', 'web_login_events', 'web_push_subscriptions',
  'raw_news', 'news_clusters', 'news_cluster_members', 'news_assets', 'news_reactions',
];

const AT = new Date(Date.UTC(2026, 5, 1, 12));

maybeDescribe('WD-006 migration 024: drop the retired tables, keep the rest', () => {
  let name: string;
  let url: string;
  let admin: Client;
  let db: PgDatabase;

  const exists = async (table: string): Promise<boolean> =>
    (await db.query<{ t: string | null }>(`select to_regclass($1)::text as t`, [`public.${table}`]))[0].t !== null;
  const count = async (table: string): Promise<number> =>
    (await db.query<{ n: number }>(`select count(*)::int n from ${table}`, []))[0].n;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_m024', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    url = u.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url, target: '023' });
    db = new PgDatabase(url);

    // the month's partitions, for the partitioned tables seeded below (kept and dropped alike)
    const partitioned = [
      { table: 'candles_1m', column: 'open_time' }, { table: 'liquidations', column: 'ts' },
      { table: 'open_interest_5m', column: 'ts' }, { table: 'collector_gaps', column: 'detected_at' },
    ];
    for (const p of partitionsFor(['2026-06'], partitioned)) await db.query(buildCreatePartition(p, partitioned));

    // tape: one dropped, two kept
    await db.query(`insert into candles_1m (venue, market, symbol, open_time, open, high, low, close, volume, source)
                    values ('binance','perp','BTCUSDT',$1,1,1,1,1,1,'ws')`, [AT]);
    await db.query(`insert into liquidations (venue, symbol, ts, side, price, qty, notional, source)
                    values ('binance','BTCUSDT',$1,'long',1,1,1,'ws')`, [AT]);
    await db.query(`insert into open_interest_5m (venue, symbol, ts, oi_base, source) values ('binance','BTCUSDT',$1,1,'rest')`, [AT]);
    // collector honesty: gap_reports dropped, collector_gaps kept
    await db.query(`insert into gap_reports (day, report, clean) values ('2026-06-01','{}',true)`, []);
    await db.query(`insert into collector_gaps (stream, venue, gap_from, gap_to, expected, repaired, detected_at)
                    values ('x','binance',$1,$1,1,0,$1)`, [AT]);
    // context: fear_greed dropped, calendar_events kept
    await db.query(`insert into fear_greed (day, value, classification) values ('2026-06-01', 50, 'Neutral')`, []);
    await db.query(`insert into calendar_events (id, revision, source, event_time) values ('e1', 1, 'forexfactory', $1)`, [AT]);
    // playbooks: playbook_config dropped, symbols kept
    await db.query(`insert into symbols (id, base, quote, binance_perp, listed_perp) values ('BTCUSDT','BTC','USDT','BTCUSDT','2019-09-08')`, []);
    await db.query(`insert into playbook_config (playbook, version, status, params, created_by) values ('p', 1, 'off', '{}', 'wd-006 spec')`, []);
    // news (kept, S8)
    await db.query(`insert into raw_news (id, source, url, title, published_at, fetched_at, url_hash, title_hash)
                    values ('n1','decrypt','https://x/n1','t',$1,$1,'u1','t1')`, [AT]);

    expect(await count('candles_1m')).toBe(1); // the seed landed: the drop below drops something real
    await runMigrations({ connectionString: url });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it.each(DROPPED)('drops %s', async (table) => {
    expect(await exists(table)).toBe(false);
  });

  it('drops the playbooks\' enum with them', async () => {
    const [r] = await db.query<{ n: number }>(`select count(*)::int n from pg_type where typname = 'playbook_source_mode'`, []);
    expect(r.n).toBe(0);
  });

  it.each(KEPT)('keeps %s', async (table) => {
    expect(await exists(table)).toBe(true);
  });

  it('kept tables keep their rows, one per family', async () => {
    for (const table of ['liquidations', 'open_interest_5m', 'collector_gaps', 'calendar_events', 'symbols', 'raw_news']) {
      expect([table, await count(table)]).toEqual([table, 1]);
    }
  });

  it('keeps pg_trgm, which raw_news\'s title index needs', async () => {
    const [r] = await db.query<{ n: number }>(`select count(*)::int n from pg_extension where extname = 'pg_trgm'`, []);
    expect(r.n).toBe(1);
  });

  it('undo recreates the 17 tables EMPTY (data is not restorable), and 024 re-applies', async () => {
    await runMigrations({ connectionString: url, target: '023' });
    for (const table of DROPPED) expect([table, await exists(table)]).toEqual([table, true]);
    expect(await count('playbook_config')).toBe(0);
    expect(await count('gap_reports')).toBe(0);
    expect(await count('liquidations')).toBe(1); // the undo did not touch a kept table

    await runMigrations({ connectionString: url });
    for (const table of DROPPED) expect([table, await exists(table)]).toEqual([table, false]);
  }, DB_HOOK_TIMEOUT_MS);
});

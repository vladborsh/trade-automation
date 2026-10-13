import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PARTITIONED_TABLES } from '../../src/db/partitions';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * Migration 002 against a real Postgres: the §3.3 tables apply and undo, the partitioning works
 * the way D7 needs it to, and the writers are idempotent.
 *
 * Runs in a throwaway database created next to the slot's own, and dropped afterwards.
 * Skipped without DATABASE_URL:
 *   DATABASE_URL=postgresql://backtest:backtest@localhost:5432/insight_dev2 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-002.integration.spec.ts: DATABASE_URL not set — skipping the time-series schema tests.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const TABLES_002 = [
  'candles_1m', 'candles_agg', 'mark_funding_1m', 'funding_settlements',
  'open_interest_5m', 'long_short_5m', 'liquidations', 'calendar_events', 'collector_gaps',
];

maybeDescribe('migration 002: the partitioned time-series schema', () => {
  let name: string;
  let scratchUrl: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_mig', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    scratchUrl = url.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    db = new PgDatabase(scratchUrl);
    await runMigrations({ connectionString: scratchUrl });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const tableNames = async (): Promise<string[]> =>
    (await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    )).map((r) => r.table_name);

  it('creates all nine §3.3 tables', async () => {
    const tables = await tableNames();
    for (const table of TABLES_002) expect(tables).toContain(table);
  });

  it('partitions exactly the tables §3.3 says to partition, by range, and leaves the other two plain', async () => {
    const partitioned = (
      await db.query<{ relname: string; strategy: string }>(
        `select c.relname, p.partstrat as strategy from pg_class c
           join pg_partitioned_table p on p.partrelid = c.oid
          where c.relkind = 'p' order by c.relname`,
      )
    );
    expect(partitioned.map((r) => r.relname).sort()).toEqual([...PARTITIONED_TABLES.map((t) => t.table)].sort());
    for (const row of partitioned) expect(row.strategy).toBe('r'); // RANGE
  });

  it('has no DEFAULT partition on any of them — the point of failing loudly', async () => {
    const defaults = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_inherits i on i.inhrelid = c.oid
        where pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT'`,
    );
    expect(defaults).toEqual([]);
  });

  describe('a write into a month with no partition', () => {
    const ts = new Date(Date.UTC(2031, 6, 15, 12, 0)); // 2031-07: far outside any month maintenance prepares
    const row: t.Candle1mRow = {
      venue: 'binance', market: 'perp', symbol: 'BTCUSDT', openTime: ts,
      open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, source: 'ws',
    };

    it('fails loudly, rather than landing anywhere', async () => {
      await expect(new BatchWriter(db, t.CANDLES_1M, t.candle1mTuple).write([row])).rejects.toThrow(
        /no partition of relation "candles_1m" found for row/,
      );
    });

    it('succeeds once maintenance creates that month, and the row lands in that partition', async () => {
      const service = new PartitionMaintenanceService(db);
      const created = await service.ensureRange(ts, ts);
      expect(created).toBe(PARTITIONED_TABLES.length);

      expect(await new BatchWriter(db, t.CANDLES_1M, t.candle1mTuple).write([row])).toBe(1);
      const [stored] = await db.query<{ tableoid: string; close: number }>(
        'select tableoid::regclass::text as tableoid, close from candles_1m where open_time = $1',
        [ts],
      );
      expect(stored.tableoid).toBe('candles_1m_2031_07');
      expect(stored.close).toBe(1.5);
    }, DB_HOOK_TIMEOUT_MS);
  });

  it('creates the current month + 3 ahead on ensureAhead, and is a no-op when re-run', async () => {
    const service = new PartitionMaintenanceService(db);
    const now = new Date(Date.UTC(2030, 10, 20)); // 2030-11 .. 2031-02
    await service.ensureAhead(now);
    const before = await partitionNames('candles_1m');
    expect(before).toEqual(expect.arrayContaining([
      'candles_1m_2030_11', 'candles_1m_2030_12', 'candles_1m_2031_01', 'candles_1m_2031_02',
    ]));

    await service.ensureAhead(now); // IF NOT EXISTS: same set, no error
    expect(await partitionNames('candles_1m')).toEqual(before);
    // DB_HOOK_TIMEOUT_MS, not the 5 s default: this creates 4 months x every partitioned table,
    // TWICE, and the table count grows — IB-028 added dex_pools and dex_pair_snapshots, so the
    // same test now does ~20 % more work than when the default was last comfortable. It timed out
    // at 5 s under a full concurrent suite on 2026-10-13 (evidence in the run log). A test whose
    // cost is a function of a shared list must not be budgeted as if it were constant.
  }, DB_HOOK_TIMEOUT_MS);

  const partitionNames = async (parent: string): Promise<string[]> =>
    (await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_inherits i on i.inhrelid = c.oid
        where i.inhparent = $1::regclass order by c.relname`,
      [parent],
    )).map((r) => r.relname);

  describe('the writers', () => {
    const month = new Date(Date.UTC(2030, 0, 15, 0, 0));

    beforeAll(async () => {
      await new PartitionMaintenanceService(db).ensureRange(month, month);
    }, DB_HOOK_TIMEOUT_MS);

    it('re-writing the same batch changes nothing (D12 idempotency on the natural key)', async () => {
      const writer = new BatchWriter(db, t.CANDLES_1M, t.candle1mTuple);
      const rows: t.Candle1mRow[] = Array.from({ length: 3 }, (_, i) => ({
        venue: 'binance', market: 'perp', symbol: 'IDEMPUSDT',
        openTime: new Date(month.getTime() + i * 60_000),
        open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, source: 'ws',
      }));

      await writer.write(rows);
      await writer.write(rows);
      const [{ count }] = await db.query<{ count: number }>(
        "select count(*)::int as count from candles_1m where symbol = 'IDEMPUSDT'",
      );
      expect(count).toBe(3);
    });

    it('a re-write with new values updates in place, and keeps one row per key', async () => {
      const writer = new BatchWriter(db, t.CANDLES_1M, t.candle1mTuple);
      const base: t.Candle1mRow = {
        venue: 'binance', market: 'perp', symbol: 'UPDUSDT', openTime: month,
        open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, source: 'ws',
      };
      await writer.write([base]);
      // What a backfill does to a bar the live stream wrote: same key, authoritative values.
      await writer.write([{ ...base, close: 9.25, volume: 42, source: 'archive' }]);

      const rows = await db.query<{ close: number; volume: number; source: string }>(
        "select close, volume, source from candles_1m where symbol = 'UPDUSDT'",
      );
      expect(rows).toEqual([{ close: 9.25, volume: 42, source: 'archive' }]);
    });

    it('keeps the first liquidation event on a replay (DO NOTHING), never a duplicate', async () => {
      const writer = new BatchWriter(db, t.LIQUIDATIONS, t.liquidationTuple);
      const event: t.LiquidationRow = {
        venue: 'binance', symbol: 'LIQUSDT', ts: month, side: 'long',
        price: 100, qty: 2, notional: 200, orderStatus: 'FILLED', source: 'ws',
      };
      await writer.write([event]);
      await writer.write([{ ...event, orderStatus: 'REPLAYED', source: 'archive' }]);

      const rows = await db.query<{ order_status: string; source: string }>(
        "select order_status, source from liquidations where symbol = 'LIQUSDT'",
      );
      expect(rows).toEqual([{ order_status: 'FILLED', source: 'ws' }]);
    });

    it('appends a collector_gaps row per observation, since it has no natural key', async () => {
      const writer = new BatchWriter(db, t.COLLECTOR_GAPS, t.collectorGapTuple);
      const gap: t.CollectorGapRow = {
        stream: 'binance-perp:kline_1m', venue: 'binance', market: 'perp', symbol: 'GAPUSDT',
        gapFrom: month, gapTo: new Date(month.getTime() + 180_000), expected: 3, detectedAt: month,
      };
      await writer.write([gap]);
      await writer.write([gap]);
      const [{ count }] = await db.query<{ count: number }>(
        "select count(*)::int as count from collector_gaps where symbol = 'GAPUSDT'",
      );
      expect(count).toBe(2);
    });

    it('writes the two unpartitioned tables without any partition being prepared', async () => {
      await new BatchWriter(db, t.FUNDING_SETTLEMENTS, t.fundingSettlementTuple).write([
        { venue: 'binance', symbol: 'FUNDUSDT', fundingTime: new Date(Date.UTC(2035, 5, 1)), rate: 0.0001, source: 'rest' },
      ]);
      await new BatchWriter(db, t.CALENDAR_EVENTS, t.calendarEventTuple).write([
        { id: 'ff-1', revision: 1, source: 'forexfactory', eventTime: new Date(Date.UTC(2035, 5, 1)), status: 'scheduled', fetchedAt: new Date() },
      ]);
      const [{ count }] = await db.query<{ count: number }>(
        "select count(*)::int as count from funding_settlements where symbol = 'FUNDUSDT'",
      );
      expect(count).toBe(1);
    });

    it('rejects a value outside a CHECK constraint', async () => {
      await expect(
        db.query("insert into candles_1m (venue, market, symbol, open_time, open, high, low, close, volume, source) values ('binance', 'futures', 'X', $1, 1, 1, 1, 1, 1, 'ws')", [month]),
      ).rejects.toThrow(/violates check constraint/);
      await expect(
        db.query("insert into liquidations (venue, symbol, ts, side, price, qty, notional, source) values ('binance', 'X', $1, 'buy', 1, 1, 1, 'ws')", [month]),
      ).rejects.toThrow(/violates check constraint/);
    });
  });

  it('undoes cleanly, dropping the partitions with their parents, and re-applies', async () => {
    await runMigrations({ connectionString: scratchUrl, target: '001' });
    const afterUndo = await tableNames();
    for (const table of TABLES_002) expect(afterUndo).not.toContain(table);
    expect(afterUndo).toContain('symbols'); // 001 is untouched
    expect(afterUndo.filter((t) => t.startsWith('candles_1m_'))).toEqual([]);

    await runMigrations({ connectionString: scratchUrl });
    for (const table of TABLES_002) expect(await tableNames()).toContain(table);
  }, DB_HOOK_TIMEOUT_MS);
});

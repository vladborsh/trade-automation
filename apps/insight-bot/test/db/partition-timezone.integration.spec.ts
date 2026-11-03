import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-BUG-002 — partition bounds must be UTC regardless of the database session's timezone.
 *
 * A partition key here is `timestamptz`, and Postgres resolves a bare literal like '2026-10-01'
 * in the SESSION's timezone. With bare literals on a US/Pacific session every monthly partition
 * slid 7 hours, so the first hours of each UTC month had no partition at all and the insert
 * failed with "no partition of relation found". The app's own TZ=UTC does not help — this is the
 * database session's zone.
 *
 * The spec therefore runs on a deliberately NON-UTC session: on a UTC one the bug is invisible.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('partition-timezone.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

/** The failure window: just after midnight UTC on the 1st of a month. */
const FIRST_OF_MONTH_0030Z = new Date('2026-10-01T00:30:00.000Z');

maybeDescribe('partition bounds on a non-UTC session (IB-BUG-002)', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_parttz', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    // the whole point: every session against this database is 7 hours off UTC
    await admin.query(`alter database ${name} set timezone to 'US/Pacific'`);

    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('the session really is non-UTC, otherwise this spec proves nothing', async () => {
    const rows = await db.query<{ TimeZone: string }>('show timezone');
    expect(rows[0]).toMatchObject({ TimeZone: 'US/Pacific' });
  });

  it('creates partitions whose bounds are the UTC month, not the session\'s', async () => {
    await new PartitionMaintenanceService(db).ensureRange(FIRST_OF_MONTH_0030Z, FIRST_OF_MONTH_0030Z);
    const rows = await db.query<{ bound: string }>(
      `select pg_get_expr(relpartbound, oid) as bound from pg_class where relname = 'liquidations_2026_10'`,
    );
    expect(rows).toHaveLength(1);
    // Postgres echoes the bound in the session's zone: 2026-10-01T00:00Z is 2026-09-30 17:00-07
    expect(rows[0].bound).toContain('2026-09-30 17:00:00-07');
  });

  it('a row at 00:30 UTC on the 1st lands in that month\'s partition', async () => {
    // WD-010: on `liquidations`, a table the box still writes (candles_1m no longer is)
    const writer = new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple);
    await new PartitionMaintenanceService(db).ensureRange(FIRST_OF_MONTH_0030Z, FIRST_OF_MONTH_0030Z);

    // before the fix this threw: no partition of relation "…" found for row
    await expect(writer.write([{
      venue: 'binance', symbol: 'BTCUSDT', ts: FIRST_OF_MONTH_0030Z, side: 'long', price: 1, qty: 1, notional: 1, source: 'ws',
    }])).resolves.not.toThrow();

    const stored = await db.query<{ ts: Date; part: string }>(
      `select ts, tableoid::regclass::text as part from liquidations where symbol = 'BTCUSDT'`,
    );
    expect(stored).toHaveLength(1);
    expect(new Date(stored[0].ts).toISOString()).toBe('2026-10-01T00:30:00.000Z');
    expect(stored[0].part).toBe('liquidations_2026_10'); // the OCTOBER partition, not September's
  });

  it('the last minute of the previous UTC month still lands in the previous partition', async () => {
    const lastMinute = new Date('2026-09-30T23:59:00.000Z');
    const writer = new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple);
    await new PartitionMaintenanceService(db).ensureRange(lastMinute, lastMinute);

    await writer.write([{
      venue: 'binance', symbol: 'ETHUSDT', ts: lastMinute, side: 'short', price: 1, qty: 1, notional: 1, source: 'ws',
    }]);
    const stored = await db.query<{ part: string }>(
      `select tableoid::regclass::text as part from liquidations where symbol = 'ETHUSDT'`,
    );
    expect(stored[0].part).toBe('liquidations_2026_09'); // the boundary is exact, not off by 7h
  });
});

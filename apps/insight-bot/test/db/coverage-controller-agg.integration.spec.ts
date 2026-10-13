import { randomUUID } from 'crypto';
import { Client } from 'pg';
import type { AppConfigService } from '../../src/config/config.service';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { WebCoverageController } from '../../src/web/coverage.controller';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-056 — the wiring, as opposed to the SQL.
 *
 * `agg-coverage.integration.spec.ts` proves the classification; this proves the endpoint actually
 * carries it, over the window the rest of the page uses. Worth its own file because the gap
 * between "the query is right" and "the page receives it" is where IB-049 lived: a version claim
 * that was correct and sat on a code path the writer never took.
 *
 * The controller is called directly, which is this repo's pattern for controller specs
 * (`context.controller.spec.ts`) — the HTTP hop and the session guard are shared infrastructure
 * with their own specs, and nothing here is specific to them.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('coverage-controller-agg.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;

maybeDescribe('IB-056 GET /api/web/coverage carries the aggregate block', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let controller: WebCoverageController;

  /** Inside the controller's default 30-day window, and far enough in to be fully closed. */
  const day = Date.UTC(2026, 9, 5);

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_aggctl', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(
      new Date(Date.UTC(2026, 9, 1)),
      new Date(Date.UTC(2026, 10, 1)),
    );

    const candles = new BatchWriter<t.Candle1mRow>(db, t.CANDLES_1M, t.candle1mTuple);
    await candles.write(
      Array.from({ length: 30 }, (_, i) => ({
        venue: 'binance',
        market: 'perp' as t.Market,
        symbol: 'BTCUSDT',
        openTime: new Date(day + i * MIN),
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        source: 'rest' as t.Source,
      })),
    );

    // Two complete 15m buckets of tape and nothing in candles_agg at all: the shape IB-057 is
    // about, and the one the page has to be able to show.
    const config = { symbols: [] } as unknown as AppConfigService;
    controller = new WebCoverageController(config, db);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('returns the derivable gap rather than an empty array', async () => {
    const response = await controller.get('30');

    const fifteen = response.agg.filter((r) => r.tf === '15m');
    expect(fifteen).toHaveLength(1);
    expect(fifteen[0]).toMatchObject({
      symbol: 'BTCUSDT',
      market: 'perp',
      held: 0,
      derivable: 2,
      unfetchable: 0,
      oldestDerivable: day,
    });
  });

  it('states the window it used, so the page can say what the figure covers', async () => {
    const response = await controller.get('30');
    expect(response.windowDays).toBe(30);
  });

  it('reports nothing outside the window rather than scanning all history', async () => {
    // A one-day window ending now cannot reach 2026-10-05 fixtures, whatever the tape holds.
    const response = await controller.get('1');
    expect(response.agg).toEqual([]);
    expect(response.windowDays).toBe(1);
  });

  it('leaves the block an empty array, not undefined, when there is no database', async () => {
    const withoutDb = new WebCoverageController({ symbols: [] } as unknown as AppConfigService, null);
    const response = await withoutDb.get('30');
    expect(response.agg).toEqual([]);
  });
});

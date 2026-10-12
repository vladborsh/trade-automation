import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { uptimeGap } from '../../src/collectors/uptime/uptime-gap';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { gapsOverlapping, heartbeats, touchHeartbeat, unmappedLiquidations } from '../../src/db/pg/coverage-reads';
import { collectorCoverage } from '../../src/web/collector-coverage';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-BUG-010 — the whole round trip against a real Postgres: a collector runs, stops, starts again,
 * and the hours it was not running become a number a statistic can divide by.
 *
 * Why this needs a real database rather than a fake: migration 010's `on conflict (stream)` upsert
 * with `greatest(...)` is the thing that stops liveness walking backwards, the `gap_from < $2 and
 * gap_to > $1` overlap is the thing that catches an outage spanning the window edge, and the
 * unmapped-spelling query is a `not exists` over four nullable columns. All three are SQL, and a
 * fake would only re-assert what I believe the SQL does.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('collector-coverage.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const HOUR = 3_600_000;
const DAY0 = Date.UTC(2026, 5, 1);
const STREAM = 'bybit:allLiquidation';

maybeDescribe('IB-BUG-010 collector coverage against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_coverage', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(DAY0), new Date(DAY0 + 3 * 86_400_000));
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('a stop and a restart leave a gap row for exactly the uncovered window', async () => {
    // the collector runs, last saying it is alive at 10:00
    await touchHeartbeat(db, { stream: STREAM, venue: 'bybit', market: 'perp' }, new Date(DAY0 + 8 * HOUR));
    await touchHeartbeat(db, { stream: STREAM, venue: 'bybit', market: 'perp' }, new Date(DAY0 + 10 * HOUR));

    // ... then the process dies and nothing is written for eight and a half hours ...
    const restart = new Date(DAY0 + 18.5 * HOUR);
    const found = await heartbeats(db);
    const gap = uptimeGap({
      stream: STREAM, venue: 'bybit', market: 'perp',
      heartbeat: found.get(STREAM) ?? null, now: restart, staleAfterMs: 120_000,
    });

    expect(gap).not.toBeNull();
    const writer = new BatchWriter<t.CollectorGapRow>(db, t.COLLECTOR_GAPS, t.collectorGapTuple);
    await writer.write([gap!]);

    // ... and the row that comes back out of the table is the window nobody was listening
    const stored = await gapsOverlapping(db, new Date(DAY0), new Date(DAY0 + 86_400_000), [STREAM]);
    expect(stored).toHaveLength(1);
    expect(stored[0].gapFrom.toISOString()).toBe(new Date(DAY0 + 10 * HOUR).toISOString());
    expect(stored[0].gapTo.toISOString()).toBe(restart.toISOString());
    expect(stored[0].error).toContain('collector not running');

    // Through the real SQL and the real arithmetic. Note the denominator: this stream's first
    // liveness is 08:00, so only 16 of the day's 24 hours are hours it was responsible for, and
    // 8.5 of those were uncovered → 7.5 covered of 16 elapsed.
    //
    // I expected 15.5 of 24 when I wrote this test and the spec corrected me, which is the point of
    // it: "elapsed" is not wall-clock, it is the time since the collector existed. Asserting 24
    // here would have been asserting that we failed to cover a morning we had not been born for.
    const coverage = collectorCoverage(found, stored, { from: new Date(DAY0), to: new Date(DAY0 + 86_400_000) });
    expect(coverage).toHaveLength(1);
    expect(coverage[0].coveredHours).toBe(7.5);
    expect(coverage[0].elapsedHours).toBe(16);
    expect(coverage[0].outages).toBe(1);
  });

  it('first_seen_at is never moved by a later heartbeat', async () => {
    const stream = 'okx:liquidation-orders';
    await touchHeartbeat(db, { stream, venue: 'okx', market: 'perp' }, new Date(DAY0 + 5 * HOUR));
    await touchHeartbeat(db, { stream, venue: 'okx', market: 'perp' }, new Date(DAY0 + 9 * HOUR));

    const beat = (await heartbeats(db)).get(stream)!;
    // if the upsert overwrote first_seen_at, coverage would silently start claiming the hours
    // before the collector existed
    expect(beat.firstSeenAt.toISOString()).toBe(new Date(DAY0 + 5 * HOUR).toISOString());
    expect(beat.lastSeenAt.toISOString()).toBe(new Date(DAY0 + 9 * HOUR).toISOString());
  });

  it('liveness never walks backwards, so a clock step cannot manufacture a gap', async () => {
    const stream = 'okx:liquidation-orders';
    await touchHeartbeat(db, { stream, venue: 'okx', market: 'perp' }, new Date(DAY0 + 4 * HOUR));
    const beat = (await heartbeats(db)).get(stream)!;
    // the earlier timestamp is ignored: greatest(), not assignment
    expect(beat.lastSeenAt.toISOString()).toBe(new Date(DAY0 + 9 * HOUR).toISOString());
  });

  it('an outage spanning the window edge is still found and clipped', async () => {
    const stream = 'binance-perp:forceOrder';
    const writer = new BatchWriter<t.CollectorGapRow>(db, t.COLLECTOR_GAPS, t.collectorGapTuple);
    await writer.write([{
      stream, venue: 'binance', market: 'perp', symbol: null,
      // starts the previous day, ends 3 h into this one
      gapFrom: new Date(DAY0 - 6 * HOUR), gapTo: new Date(DAY0 + 3 * HOUR),
      expected: 0, repaired: 0, error: 'spanning', detectedAt: new Date(DAY0 + 3 * HOUR),
    }]);

    // containment would miss it entirely; overlap finds it
    const stored = await gapsOverlapping(db, new Date(DAY0), new Date(DAY0 + 86_400_000), [stream]);
    expect(stored).toHaveLength(1);
    expect(stored[0].gapFrom.getTime()).toBe(DAY0 - 6 * HOUR);
  });

  it('counts a liquidation whose spelling is in no symbols column, and ignores ones that map', async () => {
    await db.query(
      `insert into symbols (id, base, quote, binance_perp, bybit_linear, okx_swap, listed_perp)
            values ('BTCUSDT','BTC','USDT','BTCUSDT','BTCUSDT','BTC-USDT-SWAP','2020-01-01')`,
      [],
    );
    const liq = new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple);
    await liq.write([
      // maps: bybit spelling is in bybit_linear
      { venue: 'bybit', symbol: 'BTCUSDT', ts: new Date(DAY0 + HOUR), side: 'long', price: 1, qty: 1, notional: 1, source: 'ws' },
      // maps: okx's own spelling
      { venue: 'okx', symbol: 'BTC-USDT-SWAP', ts: new Date(DAY0 + HOUR), side: 'long', price: 1, qty: 1, notional: 1, source: 'ws' },
      // does NOT map: a renamed contract nobody added to the universe
      { venue: 'bybit', symbol: 'RENAMED1000PEPEUSDT', ts: new Date(DAY0 + HOUR), side: 'short', price: 1, qty: 2, notional: 2, source: 'ws' },
      { venue: 'bybit', symbol: 'RENAMED1000PEPEUSDT', ts: new Date(DAY0 + 2 * HOUR), side: 'long', price: 1, qty: 3, notional: 3, source: 'ws' },
      // does NOT map: right spelling, wrong venue — okx's id under bybit reaches nothing
      { venue: 'bybit', symbol: 'BTC-USDT-SWAP', ts: new Date(DAY0 + 3 * HOUR), side: 'long', price: 1, qty: 1, notional: 1, source: 'ws' },
    ]);

    const unmapped = await unmappedLiquidations(db);
    expect(unmapped.total).toBe(3);
    // named, not just counted: a bare total says something is wrong without saying what to fix
    expect(unmapped.rows).toEqual([
      { venue: 'bybit', symbol: 'RENAMED1000PEPEUSDT', rows: 2 },
      { venue: 'bybit', symbol: 'BTC-USDT-SWAP', rows: 1 },
    ]);
  });
});

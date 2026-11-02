import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { uptimeGap } from '../../src/collectors/uptime/uptime-gap';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { gapsOverlapping, heartbeats, liquidationActivity, touchHeartbeat } from '../../src/db/pg/uptime-reads';
import { liquidationUptime } from '../../src/web/liquidation-uptime';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-BUG-010 — the whole round trip against a real Postgres: a collector runs, stops, starts again,
 * and the hours it was not running become a number a statistic can divide by.
 *
 * Why this needs a real database rather than a fake: migration 010's `on conflict (stream)` upsert
 * with `greatest(...)` is the thing that stops liveness walking backwards, the `gap_from < $2 and
 * gap_to > $1` overlap is the thing that catches an outage spanning the window edge, and WD-009's
 * `liquidationActivity` is a filtered aggregate over a partitioned table. All three are SQL, and a
 * fake would only re-assert what I believe the SQL does.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('uptime-reads.integration.spec.ts: DATABASE_URL not set — skipping.');
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

    // Through the real SQL and WD-009's arithmetic. The stream first heartbeat at 08:00 and was down
    // 10:00–18:30, so 7.5 h of the 24 h window were covered. WD-009 reports the WALL-CLOCK window as
    // elapsed (the coverage page used "since first seen", 16 h): the morning before the collector
    // existed is a morning whose liquidations were not recorded, and a no-rows window that includes
    // it must say `not_recorded`, not `no_events`.
    // "now" is the end of the day, and the heartbeat is refreshed so the stretch since 18:30 is live
    const now = new Date(DAY0 + 86_400_000);
    await touchHeartbeat(db, { stream: STREAM, venue: 'bybit', market: 'perp' }, now);
    const [uptime] = liquidationUptime([{ stream: STREAM, venue: 'bybit' }], await heartbeats(db), stored, new Map(), now);
    const day = uptime.windows[0];
    expect(day).toMatchObject({ hours: 24, coveredHours: 7.5, elapsedHours: 24, outages: 1, rows: 0, state: 'not_recorded' });
    expect(uptime.instrumented).toBe(true);
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

  it('liquidationActivity: newest row and counts per venue, 24 h inside 7 d, nothing older counted', async () => {
    const now = DAY0 + 2 * 86_400_000;
    const liq = new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple);
    const row = (venue: string, ms: number) => ({ venue, symbol: 'BTCUSDT', ts: new Date(ms), side: 'long' as const, price: 1, qty: 1, notional: 1, source: 'ws' as const });
    await liq.write([
      row('bybit', now - 2 * HOUR), // in 24 h and 7 d
      row('bybit', now - 30 * HOUR), // 7 d only
      row('okx', now - 40 * HOUR), // 7 d only
    ]);
    const activity = await liquidationActivity(db, new Date(now - 7 * 86_400_000), new Date(now - 86_400_000));
    expect(activity.get('bybit')).toEqual({ lastRowAt: new Date(now - 2 * HOUR), rows24h: 1, rows7d: 2 });
    expect(activity.get('okx')).toEqual({ lastRowAt: new Date(now - 40 * HOUR), rows24h: 0, rows7d: 1 });
    expect(activity.has('binance')).toBe(false);
  });
});

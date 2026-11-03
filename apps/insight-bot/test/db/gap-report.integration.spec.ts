import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { gapsForDay, saveGapReport, slotCoverage } from '../../src/db/pg/collector-reads';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { buildGapReport } from '../../src/ops/gap-report';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-011 against a real Postgres: migration 004's table, and the four reads the report is built
 * from — including the rule that a collector which started mid-day has not "missed" the morning.
 *
 * Skipped without DATABASE_URL, like the other integration specs.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('gap-report.integration.spec.ts: DATABASE_URL not set — skipping the gap-report reads.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DAY = '2026-09-20';
const DAY_START = new Date(`${DAY}T00:00:00.000Z`);
const DAY_END = new Date(`${DAY}T24:00:00.000Z`);
const MIN = 60_000;

maybeDescribe('IB-011 gap report against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_gapreport', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    db = new PgDatabase(url.toString());
    await runMigrations({ connectionString: url.toString() });
    await new PartitionMaintenanceService(db).ensureRange(DAY_START, DAY_END);

    const oi = new BatchWriter<t.OpenInterestRow>(db, t.OPEN_INTEREST_5M, t.openInterestTuple);
    const gaps = new BatchWriter<t.CollectorGapRow>(db, t.COLLECTOR_GAPS, t.collectorGapTuple);

    // WD-010: the candle tape is gone, so the first-row rule is pinned on the OI grid instead.
    // BTCUSDT: from midnight, but only the first 2 hours (24 slots) — the rest of the day is missing.
    // ETHUSDT: the poller's first slot ever is at 12:00, and every slot from then is present.
    const SLOT = 5 * MIN;
    await oi.write([
      ...Array.from({ length: 24 }, (_, i) => ({ venue: 'binance', symbol: 'BTCUSDT', ts: new Date(DAY_START.getTime() + i * SLOT), oiBase: 1, source: 'rest' as const })),
      ...Array.from({ length: 144 }, (_, i) => ({ venue: 'binance', symbol: 'ETHUSDT', ts: new Date(DAY_START.getTime() + 720 * MIN + i * SLOT), oiBase: 1, source: 'rest' as const })),
    ]);
    await gaps.write([
      { stream: 'binance-perp:oi-ls-5m', venue: 'binance', market: 'perp', symbol: 'BTCUSDT', gapFrom: new Date(DAY_START.getTime() + 5 * MIN), gapTo: new Date(DAY_START.getTime() + 15 * MIN), expected: 3, repaired: 3, detectedAt: new Date(DAY_START.getTime() + 8 * MIN) },
      { stream: 'binance-perp:forceOrder', venue: 'binance', market: 'perp', symbol: null, gapFrom: new Date(DAY_START.getTime() + 10 * MIN), gapTo: new Date(DAY_START.getTime() + 20 * MIN), expected: 0, repaired: 0, error: 'degraded mode', detectedAt: new Date(DAY_START.getTime() + 20 * MIN) },
    ]);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('slotCoverage counts expected from the series\' first slot, not from midnight', async () => {
    const rows = (await slotCoverage(db, 'open_interest_5m', DAY_START, DAY_END)).sort((a, b) => a.symbol.localeCompare(b.symbol));
    expect(rows).toEqual([
      // first slot at 00:00, so the whole day is expected and 264 slots are genuinely missing
      { venue: 'binance', symbol: 'BTCUSDT', present: 24, expected: 288 },
      // first slot at 12:00: only the afternoon is expected, and it is complete
      { venue: 'binance', symbol: 'ETHUSDT', present: 144, expected: 144 },
    ]);
    expect(await slotCoverage(db, 'long_short_5m', DAY_START, DAY_END)).toEqual([]); // nothing stored, nothing claimed
  });

  it('gapsForDay returns the day\'s rows with their repair counts', async () => {
    const rows = await gapsForDay(db, DAY_START, DAY_END);
    expect(rows.map((r) => [r.stream, r.expected, r.repaired])).toEqual([
      ['binance-perp:oi-ls-5m', 3, 3],
      ['binance-perp:forceOrder', 0, 0],
    ]);
  });

  it('the report built from these reads is not clean, and names why', async () => {
    const report = buildGapReport(
      {
        day: DAY,
        openInterest: await slotCoverage(db, 'open_interest_5m', DAY_START, DAY_END),
        longShort: await slotCoverage(db, 'long_short_5m', DAY_START, DAY_END),
        gaps: await gapsForDay(db, DAY_START, DAY_END),
        binanceWeightPeak: 178, binanceWeightIsEstimate: false, silenceThresholdMin: 3,
      },
      Date.now(),
    );
    expect(report.clean).toBe(false);
    expect(report.openInterest.missing).toEqual([{ venue: 'binance', symbol: 'BTCUSDT', missing: 264, expected: 288 }]);
    expect(report.unrepaired).toEqual([{ stream: 'binance-perp:forceOrder', symbol: null, minutes: 10, reason: 'degraded mode' }]);
  });

  it('saveGapReport stores one row per day and re-running replaces it', async () => {
    await saveGapReport(db, DAY, { day: DAY, clean: false }, false);
    await saveGapReport(db, DAY, { day: DAY, clean: true, note: 'after a backfill' }, true);
    const rows = await db.query<{ day: Date; clean: boolean; report: { note?: string } }>('select day, clean, report from gap_reports');
    expect(rows).toHaveLength(1);
    expect(rows[0].clean).toBe(true);
    expect(rows[0].report.note).toBe('after a backfill');
  });
});

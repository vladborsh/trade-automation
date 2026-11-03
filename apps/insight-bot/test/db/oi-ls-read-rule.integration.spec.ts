import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { BinanceWeightTracker } from '../../src/venues/binance/binance-weight.tracker';
import { RETENTION_MS, type FuturesDataClient } from '../../src/venues/binance/futures-data.client';
import { TtlCache } from '../../src/venues/ttl-cache';
import { OiLsService } from '../../src/web/market/oi-ls.service';
import { PERIODS } from '../../src/web/market/oi-ls-window';
import { oiLsStoredReader } from '../../src/web/series/pg/oi-ls-stored.repo';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-080 (storage ruling S3–S5) — the joined OI/LS read against a real Postgres: venue first,
 * stored rows only before the venue's first returned point, one period P, sampled by date_bin.
 *
 * The venue is a fake client that serves `value = 1 000` for every slot from `venueFirstMs` on —
 * so a stored row (value 5 / 7 / 9) appearing in the answer can only have come from the database.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('oi-ls-read-rule.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const NOW = Date.UTC(2026, 10, 3, 12, 0);
const SYMBOL = 'BTCUSDT';
const periodMsOf = (p: string) => (PERIODS.find(([name]) => name === p) as readonly [string, number])[1];

/** A venue that serves 1 000 for every period slot in [max(from, venueFirstMs), to]. */
function fakeVenue(venueFirstMs: number) {
  const calls: Array<{ period: string; fromMs: number; toMs: number }> = [];
  const client = {
    async fetchBackward(q: { endpoint: string; period: string }, fromMs: number, toMs: number) {
      calls.push({ period: q.period, fromMs, toMs });
      const step = periodMsOf(q.period);
      const rows: unknown[] = [];
      for (let ts = Math.ceil(Math.max(fromMs, venueFirstMs) / step) * step; ts <= toMs; ts += step) {
        rows.push(q.endpoint === 'openInterestHist'
          ? { symbol: SYMBOL, sumOpenInterest: '1000', sumOpenInterestValue: '2000', timestamp: ts }
          : { symbol: SYMBOL, longShortRatio: '1000', longAccount: '0.5', shortAccount: '0.5', timestamp: ts });
      }
      return rows;
    },
  } as unknown as FuturesDataClient;
  return { client, calls };
}

maybeDescribe('IB-080 OI/LS read rule against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  const service = (venueFirstMs: number, withDb = true) => {
    const venue = fakeVenue(venueFirstMs);
    const svc = new OiLsService({
      client: venue.client, weight: new BinanceWeightTracker(), cache: new TtlCache({ now: () => NOW }), now: () => NOW,
      stored: withDb ? oiLsStoredReader(db) : null,
    });
    return { svc, calls: venue.calls };
  };

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_oilsread', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(NOW - 70 * D), new Date(NOW + D));

    // 60 days of stored 5-minute OI at value 5 — INCLUDING the last 30, where the venue says 1 000
    const oi = new BatchWriter<t.OpenInterestRow>(db, t.OPEN_INTEREST_5M, t.openInterestTuple);
    const rows: t.OpenInterestRow[] = [];
    for (let ts = NOW - 60 * D; ts < NOW; ts += 5 * MIN) rows.push({ venue: 'binance', symbol: SYMBOL, ts: new Date(ts), oiBase: 5, oiQuote: 10, source: 'rest' });
    await oi.write(rows);
    // one 1-day bucket 45 days ago gets a distinct LAST row, to prove the sampling takes the last
    await db.query(`update open_interest_5m set oi_base = 9 where symbol = $1 and ts = $2`, [SYMBOL, new Date(NOW - 45 * D + D - 5 * MIN)]);
    const ls = new BatchWriter<t.LongShortRow>(db, t.LONG_SHORT_5M, t.longShortTuple);
    const lsRows: t.LongShortRow[] = [];
    for (let ts = NOW - 60 * D; ts < NOW; ts += H) lsRows.push({ venue: 'binance', symbol: SYMBOL, ts: new Date(ts), kind: 'global_account', ratio: 7, longRatio: 0.5, shortRatio: 0.5, source: 'rest' });
    await ls.write(lsRows);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('a 60-day window: stored rows before the venue\'s first point, the venue after — one period, no overlap', async () => {
    const venueFirst = NOW - RETENTION_MS + 2 * H;
    const { svc, calls } = setupOne(venueFirst);
    const res = await svc.openInterest(SYMBOL, NOW - 60 * D, NOW);
    const p = periodMsOf(calls[0].period);
    const times = res.points.map((x) => x.time * 1000);
    expect(new Set(times.map((x, i) => (i === 0 ? 0 : x - times[i - 1])).slice(1).filter((g) => g > p)).size).toBe(0); // no hole
    expect(new Set(times).size).toBe(times.length); // no duplicate
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // stored part only BEFORE the venue's first point; venue values after
    const firstVenueIdx = res.points.findIndex((x) => x.value === 1000);
    expect(res.points[firstVenueIdx].time * 1000).toBeGreaterThanOrEqual(venueFirst);
    expect(res.points.slice(0, firstVenueIdx).every((x) => x.value !== 1000 && x.time * 1000 < venueFirst)).toBe(true);
    expect(res.points.slice(firstVenueIdx).every((x) => x.value === 1000)).toBe(true);
    // the database covers `from`, so the answer is not truncated
    expect(res.truncated).toBeUndefined();
    expect(res.points[0].time * 1000).toBeLessThanOrEqual(NOW - 60 * D + p);
    expect(calls).toHaveLength(1); // 0 extra venue calls
  });

  it('STORED ROWS INSIDE THE VENUE\'S RETENTION, WITH OTHER VALUES, ARE NOT IN THE ANSWER — the venue wins', async () => {
    const { svc } = setupOne(NOW - RETENTION_MS);
    const res = await svc.openInterest(SYMBOL, NOW - 10 * D, NOW);
    expect(res.points.length).toBeGreaterThan(0);
    expect(res.points.every((x) => x.value === 1000)).toBe(true);
  });

  it('the venue\'s edge a day LATER than now − RETENTION_MS opens no hole: stored rows fill up to its first point', async () => {
    const venueFirst = NOW - RETENTION_MS + D;
    const { svc, calls } = setupOne(venueFirst);
    const res = await svc.openInterest(SYMBOL, NOW - 40 * D, NOW);
    const p = periodMsOf(calls[0].period);
    const lastStored = res.points.filter((x) => x.value !== 1000).pop();
    const firstVenue = res.points.find((x) => x.value === 1000);
    expect(lastStored).toBeDefined();
    expect((firstVenue!.time - lastStored!.time) * 1000).toBeLessThanOrEqual(p);
    expect(lastStored!.time * 1000).toBeGreaterThan(NOW - RETENTION_MS); // the stored part reached past the nominal edge
  });

  it('a window wholly older than 30 days answers from the database, not truncated when it covers `from`', async () => {
    const { svc, calls } = setupOne(NOW - RETENTION_MS);
    const res = await svc.openInterest(SYMBOL, NOW - 58 * D, NOW - 40 * D);
    expect(calls).toHaveLength(0); // nothing of it is inside retention: no venue call
    expect(res.points.length).toBeGreaterThan(0);
    expect(res.points.every((x) => x.value !== 1000)).toBe(true);
    expect(res.truncated).toBeUndefined();
  });

  it('the bucket sampling takes the LAST row of the bucket', async () => {
    const { svc } = setupOne(NOW - RETENTION_MS);
    const res = await svc.openInterest(SYMBOL, NOW - 58 * D, NOW - 40 * D); // 18 days → 30m… pick the bucket containing the marked row
    const marked = res.points.find((x) => x.time * 1000 === NOW - 45 * D + D - 5 * MIN);
    expect(marked?.value).toBe(9);
  });

  it('long/short joins the same way', async () => {
    const { svc } = setupOne(NOW - RETENTION_MS + 2 * H);
    const res = await svc.longShort(SYMBOL, 'global_account', NOW - 50 * D, NOW);
    expect(res.points[0].ratio).toBe(7);
    expect(res.points[res.points.length - 1].ratio).toBe(1000);
  });

  it('AN EMPTY DATABASE ANSWERS EXACTLY AS WD-009 (no database at all)', async () => {
    const empty = 'ETHUSDT'; // no stored rows for this symbol
    const venueFirst = NOW - RETENTION_MS;
    const withDb = service(venueFirst, true);
    const without = service(venueFirst, false);
    for (const [from, to] of [[NOW - 60 * D, NOW], [NOW - 5 * D, NOW], [NOW - 50 * D, NOW - 40 * D]] as const) {
      expect(JSON.stringify(await withDb.svc.openInterest(empty, from, to))).toBe(JSON.stringify(await without.svc.openInterest(empty, from, to)));
    }
    expect(withDb.calls).toEqual(without.calls);
  });

  function setupOne(venueFirstMs: number) {
    return service(venueFirstMs, true);
  }
});

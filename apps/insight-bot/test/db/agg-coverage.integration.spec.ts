import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { aggCoverage } from '../../src/db/pg/agg-coverage-reads';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-056 — the aggregate-coverage classification, against a real database.
 *
 * This is the file that has to be right, because the whole report rests on one distinction: a
 * bucket the 1m tape **can** support versus one it **cannot**. Everything above it is arithmetic
 * over the three numbers this query returns.
 *
 * The fixtures are built so that **a wrong implementation fails rather than merely disagreeing**:
 *
 * - `derivable` and `unfetchable` differ only in whether the minutes are there, so a query that
 *   counted "missing agg row" alone would report the unfetchable bucket as derivable.
 * - spot and perp are given *different* standings for the same symbol and timeframe, so collapsing
 *   them produces a number matching neither. That conflation was the most repeated measurement
 *   error of 2026-10-11/12 and it is the one this spec most wants to catch.
 * - the live edge is set up so a **single** cutoff cannot pass: the 1d bucket in progress is also a
 *   run of complete 15m buckets. Flooring once to 15m leaves a half-filled day looking
 *   unfetchable for ever; flooring once to 1d throws away a day of good 15m. Only a per-timeframe
 *   boundary gets both, which is what `bucketStart` per tf is for.
 * - an agg row present but `complete = false` must count as derivable, not held: a bar written
 *   from a partial fold is exactly what a re-derive repairs.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('agg-coverage.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

/** 2026-10-05, a Monday, chosen so every timeframe's boundaries fall inside the fixture. */
const DAY = Date.UTC(2026, 9, 5);
const MIN = 60_000;

function minute(symbol: string, market: t.Market, openTime: number): t.Candle1mRow {
  return {
    venue: 'binance',
    market,
    symbol,
    openTime: new Date(openTime),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    source: 'rest' as t.Source,
  };
}

function minutesFor(symbol: string, market: t.Market, fromMs: number, count: number): t.Candle1mRow[] {
  return Array.from({ length: count }, (_, i) => minute(symbol, market, fromMs + i * MIN));
}

function agg(
  symbol: string,
  market: t.Market,
  tf: t.AggTimeframe,
  openTime: number,
  over: { bars?: number; complete?: boolean } = {},
): t.CandleAggRow {
  return {
    venue: 'binance',
    market,
    symbol,
    tf,
    openTime: new Date(openTime),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    bars: over.bars ?? 15,
    complete: over.complete ?? true,
  };
}

maybeDescribe('IB-056 aggCoverage', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_aggcov', DATABASE_URL as string);
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
    const aggs = new BatchWriter<t.CandleAggRow>(db, t.CANDLES_AGG, t.candleAggTuple);

    await candles.write([
      // BTCUSDT perp: four full 15m buckets from 00:00. The first has a complete agg row, the
      // second an INCOMPLETE one, the third none at all, the fourth none at all.
      ...minutesFor('BTCUSDT', 'perp', DAY, 60),
      // Seven minutes into the FIFTH bucket (01:00–01:15), which is still open at the instant the
      // live-edge test uses. They exist so that test can fail: with no cutoff this partial bucket
      // is counted as unfetchable, and an empty open bucket would have passed either way.
      ...minutesFor('BTCUSDT', 'perp', DAY + 60 * MIN, 7),
      // BTCUSDT spot: the same four buckets, but the third is only 9 minutes long — the tape
      // cannot support it, so it is unfetchable rather than derivable. Same symbol, same
      // timeframe, a different answer: collapsing the markets cannot produce both.
      ...minutesFor('BTCUSDT', 'spot', DAY, 30),
      ...minutesFor('BTCUSDT', 'spot', DAY + 30 * MIN, 9),
      ...minutesFor('BTCUSDT', 'spot', DAY + 45 * MIN, 15),
    ]);

    await aggs.write([
      agg('BTCUSDT', 'perp', '15m', DAY),
      agg('BTCUSDT', 'perp', '15m', DAY + 15 * MIN, { bars: 9, complete: false }),
      agg('BTCUSDT', 'spot', '15m', DAY),
    ]);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  /** `now` an hour after the fixture's four buckets, so all four are closed at 15m. */
  const nowMs = DAY + 60 * MIN;

  it('separates a bucket the tape supports from one it does not', async () => {
    const rows = await aggCoverage(db, {
      fromMs: DAY,
      nowMs,
      venue: 'binance',
      timeframes: ['15m'],
    });

    const perp = rows.find((r) => r.market === 'perp');
    const spot = rows.find((r) => r.market === 'spot');

    // perp: 1 held, and 3 derivable — the incomplete row counts as derivable, not held.
    expect(perp).toMatchObject({ symbol: 'BTCUSDT', market: 'perp', tf: '15m', held: 1, derivable: 3, unfetchable: 0 });
    // spot: 1 held, 2 derivable, and the 9-minute bucket is unfetchable.
    expect(spot).toMatchObject({ symbol: 'BTCUSDT', market: 'spot', tf: '15m', held: 1, derivable: 2, unfetchable: 1 });
  });

  it('reports the oldest derivable bucket, not merely how many there are', async () => {
    const rows = await aggCoverage(db, { fromMs: DAY, nowMs, venue: 'binance', timeframes: ['15m'] });
    const perp = rows.find((r) => r.market === 'perp');

    // The first bucket is held, so the oldest gap is the second: 00:15, the incomplete row.
    expect(perp?.oldestDerivableMs).toBe(DAY + 15 * MIN);
  });

  it('excludes the live edge per timeframe: a filling 1d bucket is not a gap, its closed 15m ones are', async () => {
    const rows = await aggCoverage(db, {
      fromMs: DAY,
      nowMs,
      venue: 'binance',
      timeframes: ['15m', '1d'],
    });

    // 1d: the only day in the fixture is still filling at `now`, so it is left out entirely —
    // no row, rather than a row calling it unfetchable for ever.
    expect(rows.filter((r) => r.tf === '1d')).toEqual([]);
    // 15m over the same instant still reports its four closed buckets.
    expect(rows.filter((r) => r.tf === '15m')).toHaveLength(2);
  });

  it('counts the bucket in progress as neither held nor missing', async () => {
    // `now` is 7 minutes into the fifth 15m bucket (01:00–01:15), which holds exactly those 7
    // minutes. Without the cutoff it would be a 5th bucket counted as unfetchable — a standing
    // alarm on every series, for ever, that no action could clear.
    const rows = await aggCoverage(db, {
      fromMs: DAY,
      nowMs: DAY + 67 * MIN,
      venue: 'binance',
      timeframes: ['15m'],
    });
    const perp = rows.find((r) => r.market === 'perp');

    // Still 1 + 3 + 0 = 4 buckets, not 5: the open one is not answerable yet.
    expect((perp?.held ?? 0) + (perp?.derivable ?? 0) + (perp?.unfetchable ?? 0)).toBe(4);
  });

  it('returns nothing, and runs no query, for an empty timeframe list', async () => {
    expect(await aggCoverage(db, { fromMs: DAY, nowMs, venue: 'binance', timeframes: [] })).toEqual([]);
  });

  it('is bounded by `fromMs`: buckets before the window are not reported as gaps', async () => {
    const rows = await aggCoverage(db, {
      fromMs: DAY + 30 * MIN,
      nowMs,
      venue: 'binance',
      timeframes: ['15m'],
    });
    const perp = rows.find((r) => r.market === 'perp');

    // Only the 00:30 and 00:45 buckets remain in range, both derivable.
    expect(perp).toMatchObject({ held: 0, derivable: 2, unfetchable: 0 });
  });
});

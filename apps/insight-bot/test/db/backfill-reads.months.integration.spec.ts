import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { SERIES_TABLES, monthsWithRows, type SeriesFilter, type SeriesTable } from '../../src/db/pg/backfill-reads';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-042 — the rewritten `monthsWithRows` must return EXACTLY what the scan returned.
 *
 * The rewrite trades a `group by date_trunc(month)` over every row for an extent plus one indexed
 * `exists` per month. That is only safe if the two agree on every shape the callers can produce,
 * and the dangerous shape is a **hole in the middle of a series**: "every month between first and
 * last" would report the hole as present, `missingBetween` would then find nothing missing, and
 * the coverage page would call a gap a complete history. The probe per month is what prevents it,
 * and this file is the proof.
 *
 * The old implementation is kept here verbatim as the oracle. A spec that only asserted the new
 * one against hand-written expectations would be me checking my own arithmetic twice.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('backfill-reads.months.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

/** IB-042's predecessor, unchanged, as the thing the new query has to match. */
async function monthsByScan(db: PgDatabase, table: SeriesTable, filter: SeriesFilter): Promise<string[]> {
  const params: unknown[] = [filter.venue, filter.symbol];
  let sql = 'venue = $1 and symbol = $2';
  if (filter.market) {
    params.push(filter.market);
    sql += ` and market = $${params.length}`;
  }
  const rows = await db.query<{ month: string }>(
    `select to_char(date_trunc('month', ${table.timeColumn}), 'YYYY-MM') as month
       from ${table.table}
      where ${sql}
      group by 1
      order by 1`,
    params,
  );
  return rows.map((r) => r.month);
}

const MONTH = (y: number, m: number, day = 2) => new Date(Date.UTC(y, m - 1, day, 0, 0, 0));

maybeDescribe('IB-042 monthsWithRows equivalence', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_months', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db)
      .ensureRange(new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2026, 6, 1)));

    const candles = new BatchWriter<t.Candle1mRow>(db, t.CANDLES_1M, t.candle1mTuple);
    const bar = (symbol: string, when: Date, market: 'perp' | 'spot' = 'perp'): t.Candle1mRow => ({
      venue: 'binance', market, symbol, openTime: when,
      open: 1, high: 1, low: 1, close: 1, volume: 1, takerBuyVolume: 0, source: 'archive' as const,
    });

    await candles.write([
      // CONTIGUOUS: 2025-01 .. 2025-04
      ...[1, 2, 3, 4].map((m) => bar('CONTIGUOUS', MONTH(2025, m))),
      // HOLEY: 2025-01, 2025-02, [2025-03 MISSING], 2025-04, [2025-05 MISSING], 2025-06
      ...[1, 2, 4, 6].map((m) => bar('HOLEY', MONTH(2025, m))),
      // ONEMONTH: a single month, where first and last are the same bucket
      bar('ONEMONTH', MONTH(2025, 7)),
      // EDGES: rows on the very first and very last instant of their months
      bar('EDGES', new Date(Date.UTC(2025, 7, 1, 0, 0, 0))),
      bar('EDGES', new Date(Date.UTC(2025, 8, 30, 23, 59, 0))),
      // SPANSYEAR: December to January, so the generated series crosses a year boundary
      bar('SPANSYEAR', MONTH(2025, 12)),
      bar('SPANSYEAR', MONTH(2026, 1)),
      // MARKETS: the same symbol in two markets — the filter must not mix them
      bar('MARKETS', MONTH(2025, 1), 'perp'),
      bar('MARKETS', MONTH(2025, 5), 'spot'),
    ]);

    // A table the BACKFILL reads and the coverage page also reads, with no `market` column: the
    // rewrite builds its `where` from the same helper, so both arities need proving.
    const oi = new BatchWriter<t.OpenInterestRow>(db, t.OPEN_INTEREST_5M, t.openInterestTuple);
    await oi.write([1, 2, 5].map((m) => ({
      venue: 'binance', symbol: 'HOLEY', ts: MONTH(2025, m), oiBase: 1, oiQuote: null, source: 'archive' as const,
    })));

    const funding = new BatchWriter<t.FundingSettlementRow>(db, t.FUNDING_SETTLEMENTS, t.fundingSettlementTuple);
    await funding.write([3, 6].map((m) => ({
      venue: 'bybit', symbol: 'HOLEY', fundingTime: MONTH(2025, m), rate: 0.0001, source: 'rest' as const,
    })));
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const candlesOf = (symbol: string, market = 'perp') =>
    ({ venue: 'binance', symbol, market }) satisfies SeriesFilter;

  /** Both implementations, asserted equal AND asserted to be the expected value. */
  const bothAgree = async (table: SeriesTable, filter: SeriesFilter, expected: string[]) => {
    const [fresh, oracle] = await Promise.all([
      monthsWithRows(db, table, filter),
      monthsByScan(db, table, filter),
    ]);
    expect(oracle).toEqual(expected);
    expect(fresh).toEqual(oracle);
  };

  it('agrees on a contiguous history', async () => {
    await bothAgree(SERIES_TABLES.candles, candlesOf('CONTIGUOUS'), ['2025-01', '2025-02', '2025-03', '2025-04']);
  });

  it('A HOLE IN THE MIDDLE IS STILL A HOLE — the case the shortcut would get wrong', async () => {
    // "generate every month between first and last" would answer six months here and the page
    // would report a complete history over a two-month gap. The exists probe is what makes the
    // rewrite safe, and this is the assertion that holds it to that.
    await bothAgree(SERIES_TABLES.candles, candlesOf('HOLEY'), ['2025-01', '2025-02', '2025-04', '2025-06']);
  });

  it('agrees on a single-month series, where first and last share a bucket', async () => {
    await bothAgree(SERIES_TABLES.candles, candlesOf('ONEMONTH'), ['2025-07']);
  });

  it('agrees on rows at the first and last instant of a month', async () => {
    // `>= m and < m + 1 month` is a half-open range; an off-by-one here would drop a month whose
    // only row sits on a boundary.
    //
    // The literal months are NOT asserted, and that is deliberate. `date_trunc('month', ts)` on a
    // `timestamptz` truncates in the SESSION time zone, so a row at 2025-08-01T00:00Z lands in
    // `2025-07` on a server at UTC-7 and in `2025-08` on one at UTC. Both implementations are
    // equally affected — which is exactly what this file is for — but hard-coding either answer
    // would make the spec pass or fail by the machine's clock.
    //
    // That time-zone dependence is a PRE-EXISTING bug, not something IB-042 introduced, and it
    // is worse than it looks: `missingBetween` in coverage.controller.ts generates its months in
    // UTC (`getUTCMonth`), so on any non-UTC server the two disagree and a month that HAS rows is
    // reported missing. Demonstrated and reported separately; deliberately not fixed here,
    // because IB-042's contract is to return exactly what the scan returned.
    const [fresh, oracle] = await Promise.all([
      monthsWithRows(db, SERIES_TABLES.candles, candlesOf('EDGES')),
      monthsByScan(db, SERIES_TABLES.candles, candlesOf('EDGES')),
    ]);
    expect(fresh).toEqual(oracle);
    expect(fresh).toHaveLength(2);
  });

  it('agrees across a year boundary', async () => {
    await bothAgree(SERIES_TABLES.candles, candlesOf('SPANSYEAR'), ['2025-12', '2026-01']);
  });

  it('keeps the markets apart, as the old one did', async () => {
    await bothAgree(SERIES_TABLES.candles, candlesOf('MARKETS', 'perp'), ['2025-01']);
    await bothAgree(SERIES_TABLES.candles, candlesOf('MARKETS', 'spot'), ['2025-05']);
  });

  it('returns nothing for a series with no rows, rather than a generated range', async () => {
    // `generate_series(null, null, …)` yields no rows; the `where lo is not null` guard makes
    // that explicit rather than relying on it.
    await bothAgree(SERIES_TABLES.candles, candlesOf('NOSUCHSYMBOL'), []);
  });

  describe('the shapes the BACKFILL asks for, not just the coverage page', () => {
    // backfill.runner.ts calls this for openInterest, funding, candles and longShort — three of
    // those have no `market` column, so the two-parameter `where` has to work as well.
    it('agrees on open interest, which the backfill reads with no market', async () => {
      await bothAgree(SERIES_TABLES.openInterest, { venue: 'binance', symbol: 'HOLEY' }, ['2025-01', '2025-02', '2025-05']);
    });

    it('agrees on funding settlements under a non-binance venue', async () => {
      await bothAgree(SERIES_TABLES.funding, { venue: 'bybit', symbol: 'HOLEY' }, ['2025-03', '2025-06']);
    });

    it('agrees on a series the backfill has never written', async () => {
      await bothAgree(SERIES_TABLES.longShort, { venue: 'binance', symbol: 'HOLEY' }, []);
    });

    it('still drives the resume decision the same way', async () => {
      // The runner does `new Set(await monthsWithRows(...))` and skips a month it finds. What
      // matters to it is membership, so that is what is asserted — a month with rows is skipped,
      // a hole is not, and a month outside the extent is not.
      const already = new Set(await monthsWithRows(db, SERIES_TABLES.candles, candlesOf('HOLEY')));
      expect(already.has('2025-02')).toBe(true);
      expect(already.has('2025-03')).toBe(false); // the hole must still be re-fetched
      expect(already.has('2025-09')).toBe(false); // beyond the extent
    });
  });
});

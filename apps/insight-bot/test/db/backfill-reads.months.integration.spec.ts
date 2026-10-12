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
 *
 * **IB-043 — THE ORACLE IS NOT THE AUTHORITY, and this file is the reason that matters.** When it
 * was written, every case here passed, and the pair was still wrong: both implementations
 * truncated months in the SESSION time zone while both CALLERS label months in UTC, so a row on
 * a month boundary was filed under the wrong month by each of them equally. **An equivalence
 * spec pins behaviour; it does not validate it.** The fixtures were all mid-month, so nothing
 * here could see it.
 *
 * So the two IB-043 cases below assert LITERAL UTC months and deliberately do not consult the
 * oracle: the oracle still has the bug. Everything else keeps comparing against it, because for
 * mid-month rows the two zones agree and the oracle is still the best available check that the
 * `exists` rewrite did not change the shape of the answer.
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
      // WHOLEMONTH: exactly one complete UTC month, first and last minute — the shape a single
      // archive file produces, and the one that made the backfill skip the month before it
      bar('WHOLEMONTH', new Date(Date.UTC(2025, 10, 1, 0, 0, 0))),
      bar('WHOLEMONTH', new Date(Date.UTC(2025, 10, 15, 12, 0, 0))),
      bar('WHOLEMONTH', new Date(Date.UTC(2025, 10, 30, 23, 59, 0))),
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

  it('IB-043: A ROW EXACTLY ON A UTC MONTH BOUNDARY LANDS IN THAT MONTH', async () => {
    // The only fixture that can see the bug IB-042's equivalence spec passed straight through.
    // 2025-08-01T00:00Z is 2025-07-31 17:00 under US/Pacific, so the old SQL labelled it
    // `2025-07` while both callers label months in UTC. The answer must not depend on where the
    // server happens to be: these literals are correct in every zone.
    expect(await monthsWithRows(db, SERIES_TABLES.candles, candlesOf('EDGES'))).toEqual(['2025-08', '2025-09']);
  });

  it('IB-043: THE BACKFILL CANNOT SKIP A MONTH IT NEVER DOWNLOADED', async () => {
    // One complete UTC month and nothing else. Under the old SQL at US/Pacific this answered
    // {2025-07, 2025-08}, and `monthsToFetch` — which filters a UTC want-list by this have-list
    // — then dropped July from the downloads for good. The coverage page asked whether July was
    // present, got the same wrong label back, and reported no gap: the fetcher and the detector
    // shared the mistake, so the hole was invisible to the only thing that looks for holes.
    const stored = await monthsWithRows(db, SERIES_TABLES.candles, candlesOf('WHOLEMONTH'));
    expect(stored).toEqual(['2025-11']);
    expect(stored).not.toContain('2025-10');

    // and the resume filter the runner actually uses, exercised rather than described
    const already = new Set(stored);
    expect(['2025-10', '2025-11', '2025-12'].filter((m) => !already.has(m))).toEqual(['2025-10', '2025-12']);
  });

  it('agrees on rows at the first and last instant of a month', async () => {
    // `>= m and < m + 1 month` is a half-open range; an off-by-one here would drop a month whose
    // only row sits on a boundary.
    //
    // IB-043 made this assertable: the months are UTC by construction now, so the literals hold
    // in every zone. The oracle is NOT compared here — it still truncates in the session zone,
    // which is the bug, and the test above is the one that pins the right answer.
    expect(await monthsWithRows(db, SERIES_TABLES.candles, candlesOf('EDGES'))).toEqual(['2025-08', '2025-09']);
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

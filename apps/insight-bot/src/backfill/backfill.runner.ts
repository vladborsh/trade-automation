/**
 * IB-012 — the historical backfill (design §5, D8), as one resumable job per symbol.
 *
 * Shape of a run, per symbol and series:
 *   monthly archive files → daily archive files for the current month → the REST tail.
 *
 * Three properties the design asks for, and where each one lives:
 *
 * - **Idempotent.** Every write goes through the same `BatchWriter` upsert the collectors use
 *   (D12: natural keys), so re-running a month replaces rather than duplicates.
 * - **Resumable by month.** Before downloading, the runner reads which months already hold rows
 *   and skips them unless `--force`. A run interrupted after 40 of 60 months costs 20 on retry.
 * - **It creates partitions as it goes** — a 2019 month has no partition on a fresh database.
 *
 * And the rule inherited from IB-011: a file the venue never served is **absent**, not missing.
 * Absence below a measured floor is recorded as such and never reaches the gap report as a hole.
 */

import { ArchiveClient, mapWithConcurrency, metricsFloor, WeightThrottle } from '@trade-automation/binance-client';
import { BatchWriter } from '../collectors/writers/batch-writer';
import * as t from '../collectors/writers/tables';
import type { Db } from '../db/db.port';
import { monthsWithRows, SERIES_TABLES, seriesExtent } from '../db/pg/backfill-reads';
import type { PartitionMaintenanceService } from '../db/partitions.service';
import { buildSeriesCoverage, type SeriesCoverage, type SeriesKey } from './coverage';
import {
  daysBetween, daysInMonth, lastCompleteMonth, monthOf, monthsBetween, type Day, type Month,
} from './calendar-range';
import { fetchFundingMonth, fetchKlineDay, fetchKlineMonth, fetchMetricsDay, BINANCE } from './archive-sources';
import { BybitRest } from '../collectors/bybit/rest';
import { binanceFundingRange, binanceKlineRange, okxFundingFloor, okxFundingHistory, type FetchLike } from './rest-tail';

export const ARCHIVE_PARALLEL = 4;

export interface BackfillLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

export interface BackfillOptions {
  db: Db;
  partitions: PartitionMaintenanceService;
  client?: ArchiveClient;
  throttle?: WeightThrottle;
  logger?: BackfillLogger;
  /** Re-download months that already hold rows. */
  force?: boolean;
  now?: () => Date;
  /**
   * The REST tail's fetch. Omitted (as in the specs) the archive part still runs and the tail is
   * skipped — the archive is the bulk, and a run with no network tail is still useful.
   */
  fetchImpl?: FetchLike;
}

export interface SymbolPlan {
  symbol: string;
  /** First month to ask for 1m perp candles — the symbol's listing. */
  perpFrom: Month;
  /** First month for spot candles; omitted when the symbol has no spot market. */
  spotFrom?: Month | null;
  /** First month for Binance funding (2020-01 for everything served). */
  fundingFrom: Month;
  /** The Bybit linear contract, when the symbol has one. */
  bybitLinear?: string | null;
  /** The OKX swap instrument id, when the symbol has one. */
  okxSwap?: string | null;
}

const noopLogger: BackfillLogger = { log: () => {}, warn: () => {} };

export class BackfillRunner {
  private readonly client: ArchiveClient;
  private readonly logger: BackfillLogger;
  private readonly now: () => Date;
  private readonly throttle: WeightThrottle;

  constructor(private readonly options: BackfillOptions) {
    this.client = options.client ?? new ArchiveClient();
    this.logger = options.logger ?? noopLogger;
    this.now = options.now ?? (() => new Date());
    // §5: our own 600/min ceiling, and a stop when the venue's own header passes 1200
    this.throttle = options.throttle ?? new WeightThrottle();
  }

  /** Runs every series for one symbol and returns its coverage rows. */
  async runSymbol(plan: SymbolPlan): Promise<SeriesCoverage[]> {
    const out: SeriesCoverage[] = [];
    out.push(await this.runKlines(plan.symbol, 'perp', plan.perpFrom));
    if (plan.spotFrom) out.push(await this.runKlines(plan.symbol, 'spot', plan.spotFrom));
    out.push(await this.runFunding(plan.symbol, plan.fundingFrom));
    out.push(...(await this.runMetrics(plan.symbol, plan.perpFrom)));
    if (plan.bybitLinear) out.push(await this.runBybitFunding(plan.bybitLinear, plan.fundingFrom));
    if (plan.okxSwap) out.push(await this.runOkxFunding(plan.okxSwap, plan.fundingFrom));
    return out;
  }

  // ---------------------------------------------------------------- 1m candles

  private async runKlines(symbol: string, market: t.Market, from: Month): Promise<SeriesCoverage> {
    const writer = new BatchWriter<t.Candle1mRow>(this.options.db, t.CANDLES_1M, t.candle1mTuple);
    const filter = { venue: BINANCE, symbol, market };
    const to = lastCompleteMonth(this.now());
    const months = await this.monthsToFetch(SERIES_TABLES.candles, filter, from, to);

    this.logger.log(`${symbol} ${market} 1m: ${months.length} month(s) to fetch (${from}..${to})`);
    const absent: Month[] = [];
    await mapWithConcurrency(months, ARCHIVE_PARALLEL, async (month) => {
      const result = await fetchKlineMonth(this.client, market, symbol, month);
      if (result.kind === 'absent') { absent.push(month); return; }
      await this.write(writer, result.rows, month);
    });
    if (absent.length > 0) this.logger.warn(`${symbol} ${market} 1m: archive has no file for ${absent.join(', ')}`);

    // the current month is served as DAILY files only
    await this.runKlineDays(symbol, market, writer);
    // ...and the hours since the last daily file closed come from REST
    await this.runKlineRestTail(symbol, market, writer, filter);

    return this.coverage(symbol, market === 'perp' ? 'candles_1m_perp' : 'candles_1m_spot', SERIES_TABLES.candles, filter, from, monthOf(this.today()), null);
  }

  private async runKlineDays(symbol: string, market: t.Market, writer: BatchWriter<t.Candle1mRow>): Promise<void> {
    const today = this.today();
    const firstOfMonth = `${monthOf(today)}-01` as Day;
    // yesterday: today's daily file does not exist until the day closes
    const days = daysBetween(firstOfMonth, today).slice(0, -1);
    if (days.length === 0) return;

    await mapWithConcurrency(days, ARCHIVE_PARALLEL, async (day) => {
      const result = await fetchKlineDay(this.client, market, symbol, day);
      if (result.kind === 'ok') await this.write(writer, result.rows, day);
    });
  }

  /** The bars between the newest stored one and now — what no archive file covers yet. */
  private async runKlineRestTail(
    symbol: string, market: t.Market, writer: BatchWriter<t.Candle1mRow>,
    filter: { venue: string; symbol: string; market: string },
  ): Promise<void> {
    if (!this.options.fetchImpl) return;
    const extent = await seriesExtent(this.options.db, SERIES_TABLES.candles, filter);
    if (!extent.lastRow) return;

    const from = new Date(extent.lastRow).getTime() + 60_000;
    const to = this.now().getTime();
    if (from >= to) return;

    const rows = await binanceKlineRange(
      { fetchImpl: this.options.fetchImpl, throttle: this.throttle }, market, symbol, from, to,
    );
    await this.write(writer, rows, `${market} REST tail`);
  }

  // ------------------------------------------------------------------ funding

  private async runFunding(symbol: string, from: Month): Promise<SeriesCoverage> {
    const writer = new BatchWriter<t.FundingSettlementRow>(this.options.db, t.FUNDING_SETTLEMENTS, t.fundingSettlementTuple);
    const filter = { venue: BINANCE, symbol };
    const to = lastCompleteMonth(this.now());
    const months = await this.monthsToFetch(SERIES_TABLES.funding, filter, from, to);

    this.logger.log(`${symbol} funding: ${months.length} month(s) to fetch`);
    await mapWithConcurrency(months, ARCHIVE_PARALLEL, async (month) => {
      const result = await fetchFundingMonth(this.client, symbol, month);
      if (result.kind === 'ok') await this.write(writer, result.rows, month);
    });

    // the archive's last monthly file ends where the current month begins; REST covers the rest
    if (this.options.fetchImpl) {
      const extent = await seriesExtent(this.options.db, SERIES_TABLES.funding, filter);
      const tailFrom = extent.lastRow ? new Date(extent.lastRow).getTime() + 1 : monthStartMs(from);
      const rows = await binanceFundingRange(
        { fetchImpl: this.options.fetchImpl, throttle: this.throttle }, symbol, tailFrom, this.now().getTime(),
      );
      await this.write(writer, rows, 'funding REST tail');
    }

    return this.coverage(symbol, 'funding_binance', SERIES_TABLES.funding, filter, from, monthOf(this.today()), null);
  }

  /**
   * Bybit funding, paged backwards to the venue's own start (measured: from listing, ~30–36
   * pages for a cold symbol). No archive exists for this, so REST is the only route.
   */
  private async runBybitFunding(symbol: string, from: Month): Promise<SeriesCoverage> {
    const filter = { venue: 'bybit', symbol };
    if (!this.options.fetchImpl) {
      return this.coverage(symbol, 'funding_bybit', SERIES_TABLES.funding, filter, from, monthOf(this.today()), null);
    }
    const writer = new BatchWriter<t.FundingSettlementRow>(this.options.db, t.FUNDING_SETTLEMENTS, t.fundingSettlementTuple);
    const rest = new BybitRest({ fetchImpl: this.options.fetchImpl as never });

    let endTime: number | undefined;
    let oldestSeen = Number.POSITIVE_INFINITY;
    // Bybit serves from each contract's own listing, and we only learn WHERE that is by paging
    // until the venue stops. Reaching that wall is the venue's depth, not a hole in our data —
    // without this, every symbol reported "missing" for every month before it listed on Bybit.
    let reachedWall = false;
    for (let page = 0; page < 60; page++) {
      const rows = await rest.fundingHistory(symbol, endTime);
      if (rows.length === 0) { reachedWall = true; break; }
      const mapped: t.FundingSettlementRow[] = rows.map((r) => ({
        venue: 'bybit', symbol, fundingTime: new Date(Number(r.fundingRateTimestamp)),
        rate: Number(r.fundingRate), markPrice: null, source: 'rest' as const,
      })).filter((r) => Number.isFinite(r.fundingTime.getTime()) && Number.isFinite(r.rate));
      await this.write(writer, mapped, `bybit funding page ${page + 1}`);

      const oldest = Math.min(...mapped.map((r) => r.fundingTime.getTime()));
      if (!Number.isFinite(oldest) || oldest >= oldestSeen) { reachedWall = true; break; }
      oldestSeen = oldest;
      endTime = oldest - 1;
    }

    // Only when the venue actually ran out do we know its start; stopping on the page cap would
    // make an incomplete walk look like the venue's own limit, which is the opposite mistake.
    const servedFrom = reachedWall && Number.isFinite(oldestSeen)
      ? monthOf(new Date(oldestSeen).toISOString().slice(0, 10))
      : null;
    if (servedFrom) this.logger.log(`  bybit ${symbol}: the venue serves from ${servedFrom}`);
    return this.coverage(symbol, 'funding_bybit', SERIES_TABLES.funding, filter, from, monthOf(this.today()), servedFrom);
  }

  /**
   * OKX funding. The venue serves only about the last 97 days, so the months before that are
   * `unavailable` — a fact about OKX, not a hole, and the coverage report says which.
   */
  private async runOkxFunding(instId: string, from: Month): Promise<SeriesCoverage> {
    const filter = { venue: 'okx', symbol: instId };
    const floorMs = okxFundingFloor(this.now().getTime());
    const servedFrom = monthOf(new Date(floorMs).toISOString().slice(0, 10));

    if (this.options.fetchImpl) {
      const writer = new BatchWriter<t.FundingSettlementRow>(this.options.db, t.FUNDING_SETTLEMENTS, t.fundingSettlementTuple);
      const { rows, reachedWall } = await okxFundingHistory(this.options.fetchImpl, instId, floorMs, this.now().getTime());
      await this.write(writer, rows, 'okx funding');
      if (reachedWall) this.logger.log(`  okx ${instId}: reached the venue's ~97-day wall, as expected`);
    }
    return this.coverage(instId, 'funding_okx', SERIES_TABLES.funding, filter, from, monthOf(this.today()), servedFrom);
  }

  // ------------------------------------------- open interest and long/short 5m

  private async runMetrics(symbol: string, perpFrom: Month): Promise<SeriesCoverage[]> {
    const oiWriter = new BatchWriter<t.OpenInterestRow>(this.options.db, t.OPEN_INTEREST_5M, t.openInterestTuple);
    const lsWriter = new BatchWriter<t.LongShortRow>(this.options.db, t.LONG_SHORT_5M, t.longShortTuple);
    const filter = { venue: BINANCE, symbol };

    // the measured floor: BTCUSDT 2020-09-01, everything else 2021-12-01 (404 before that)
    const floorDay = metricsFloor(symbol) as Day;
    const floorMonth = monthOf(floorDay);
    const from = floorMonth > perpFrom ? floorMonth : perpFrom;
    const to = monthOf(this.today());

    const already = this.options.force ? [] : await monthsWithRows(this.options.db, SERIES_TABLES.openInterest, filter);
    const months = monthsBetween(from, to).filter((m) => !already.includes(m));
    this.logger.log(`${symbol} metrics: ${months.length} month(s) of daily files (floor ${floorDay})`);

    for (const month of months) {
      // daily files only — the monthly metrics prefix does not exist at all
      const days = daysInMonth(month).filter((d) => d >= floorDay && d < this.today());
      const absent: Day[] = [];
      await mapWithConcurrency(days, ARCHIVE_PARALLEL, async (day) => {
        const result = await fetchMetricsDay(this.client, symbol, day);
        if (result.kind === 'absent') { absent.push(day); return; }
        await this.write(oiWriter, result.rows.openInterest, day);
        await this.write(lsWriter, result.rows.longShort, day);
      });
      if (absent.length === days.length && days.length > 0) {
        this.logger.warn(`${symbol} metrics ${month}: the archive served no day of this month`);
      }
    }

    return [
      await this.coverage(symbol, 'open_interest_5m', SERIES_TABLES.openInterest, filter, perpFrom, to, floorMonth),
      await this.coverage(symbol, 'long_short_5m', SERIES_TABLES.longShort, filter, perpFrom, to, floorMonth),
    ];
  }

  // -------------------------------------------------------------------- shared

  private today(): Day {
    return this.now().toISOString().slice(0, 10) as Day;
  }

  /** The months in `[from, to]` that do not already hold rows (unless forced). */
  private async monthsToFetch(
    table: typeof SERIES_TABLES[keyof typeof SERIES_TABLES],
    filter: { venue: string; symbol: string; market?: string },
    from: Month,
    to: Month,
  ): Promise<Month[]> {
    const all = monthsBetween(from, to);
    if (this.options.force) return all;
    const already = new Set(await monthsWithRows(this.options.db, table, filter));
    return all.filter((m) => !already.has(m));
  }

  /** Creates the partitions the rows need, then writes them. */
  private async write<T>(writer: BatchWriter<T>, input: readonly T[], label: string): Promise<void> {
    // The archive files are not always unique on their own key: the 5-minute metrics files
    // repeat a timestamp now and then (research/deriv-positioning/fetch_metrics.py drops
    // duplicates for the same reason). Postgres rejects a whole statement with "ON CONFLICT DO
    // UPDATE command cannot affect row a second time", so the duplicates go before the write.
    const rows = dedupeByConflictKey(input);
    if (rows.length === 0) return;
    if (rows.length !== input.length) {
      this.logger.warn(`  ${label}: ${input.length - rows.length} duplicate row(s) in the source file, keeping the last of each`);
    }
    const times = rows.map((r) => stampOf(r)).filter((d): d is Date => d instanceof Date);
    if (times.length > 0) {
      const min = new Date(Math.min(...times.map((d) => d.getTime())));
      const max = new Date(Math.max(...times.map((d) => d.getTime())) + 1);
      await this.options.partitions.ensureRange(min, max);
    }
    await writer.write(rows as T[]);
    this.logger.log(`  ${label}: ${rows.length} rows`);
  }

  private async coverage(
    symbol: string,
    series: SeriesKey,
    table: typeof SERIES_TABLES[keyof typeof SERIES_TABLES],
    filter: { venue: string; symbol: string; market?: string },
    requestedFrom: Month,
    requestedTo: Month,
    servedFrom: Month | null,
  ): Promise<SeriesCoverage> {
    const [present, extent] = await Promise.all([
      monthsWithRows(this.options.db, table, filter),
      seriesExtent(this.options.db, table, filter),
    ]);
    return buildSeriesCoverage({
      symbol, series, monthsPresent: present, requestedFrom, requestedTo, servedFrom,
      rows: extent.rows, firstRow: extent.firstRow, lastRow: extent.lastRow,
    });
  }
}

function monthStartMs(month: Month): number {
  return Date.parse(`${month}-01T00:00:00.000Z`);
}

/**
 * The natural key each row shape is upserted on (D12), as a string. Keeping the LAST of a
 * duplicated key matches the upsert's own semantics: the later row would have won anyway.
 */
export function conflictKeyOf(row: unknown): string {
  const r = row as {
    venue?: string; market?: string; symbol?: string; kind?: string;
    openTime?: Date; fundingTime?: Date; ts?: Date;
  };
  const stamp = r.openTime ?? r.fundingTime ?? r.ts;
  return [r.venue, r.market ?? '', r.symbol, r.kind ?? '', stamp ? stamp.getTime() : ''].join('|');
}

export function dedupeByConflictKey<T>(rows: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(conflictKeyOf(row), row);
  return byKey.size === rows.length ? (rows as T[]) : [...byKey.values()];
}

/** The one timestamp field each row shape carries. */
function stampOf(row: unknown): Date | null {
  const r = row as { openTime?: Date; fundingTime?: Date; ts?: Date };
  return r.openTime ?? r.fundingTime ?? r.ts ?? null;
}

import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { WebCoverageResponse, WebCoverageRow, WebFrameCoverage } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import { monthsWithRows, seriesBounds, SERIES_TABLES } from '../db/pg/backfill-reads';
import { gapsOverlapping, heartbeats, unmappedLiquidations } from '../db/pg/coverage-reads';
import { aggCoverage as readAggCoverage } from '../db/pg/agg-coverage-reads';
import { AGG_TIMEFRAMES } from '../derive/bucket';
import { aggCoverage } from './agg-coverage';
import { collectorCoverage } from './collector-coverage';
import { expectedFrames } from '../features/frame-coverage';
import { HEAL_LOOKBACK_MS } from '../features/input-completeness';
import { frameCounts } from '../features/pg/frames.repo';
import { FRAME_TIMEFRAMES } from '../features/recheck-schedule';

/**
 * architecture/insight-bot-web-dashboard.md §2, §4 — `GET /api/web/coverage`: per symbol × series,
 * the first and last row held and the months missing between them.
 *
 * It reuses IB-012's `backfill-reads.ts` rather than writing its own SQL: the dashboard must show
 * the same coverage the backfill acts on, and two queries answering "what do we hold" would drift.
 * Guarded by IB-029's `APP_GUARD` on `/api/web`, like everything else here.
 *
 * IB-BUG-010 adds two things the series rows above cannot express:
 *
 * - **`collectors`** — covered vs elapsed hours per collector stream. "No liquidation this hour"
 *   and "nobody was listening this hour" are identical in the data, and a statistic that cannot
 *   tell them apart reads downtime as a quiet market. dev-2's IB-038 ratio divides by
 *   `coveredHours`.
 * - **`unmapped`** — liquidation rows whose `(venue, symbol)` matches no `symbols` spelling, and so
 *   are unreachable from any canonical id and reach no page at all.
 *
 * IB-015 adds **`frames`**, its own block rather than a member of `collectors`. The two measure
 * different things and merging them would make a frame problem read as a collector problem: a
 * stream can be up for every hour of the window while every frame in it refuses, because
 * liveness says a socket was connected and says nothing about whether the buckets it fed healed.
 */
@Controller('api/web/coverage')
export class WebCoverageController {
  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) private readonly db: Db | null,
  ) {}

  @Get()
  async get(@Query('days') daysRaw?: string): Promise<WebCoverageResponse> {
    const windowDays = clampDays(daysRaw);
    if (!this.db)
      return { rows: [], collectors: [], unmapped: { total: 0, rows: [] }, frames: [], agg: [], windowDays };
    const db = this.db;
    const rows: WebCoverageRow[] = [];

    for (const symbol of this.config.symbols) {
      for (const [series, table] of Object.entries(SERIES_TABLES)) {
        const filter = { venue: 'binance', symbol: symbol.binance_perp, market: table.table === 'candles_1m' ? 'perp' : undefined };
        // IB-042: bounds, not the full extent — this page never read the row count, and
        // counting is what forced a scan per series.
        const extent = await seriesBounds(db, table, filter);
        const firstMs = extent.firstRow === null ? null : Date.parse(extent.firstRow);
        const lastMs = extent.lastRow === null ? null : Date.parse(extent.lastRow);
        rows.push({
          symbol: symbol.id,
          series,
          firstRow: firstMs,
          lastRow: lastMs,
          missingMonths: firstMs === null ? [] : missingBetween(await monthsWithRows(db, table, filter), firstMs, lastMs),
        });
      }
    }

    const to = new Date();
    const from = new Date(to.getTime() - windowDays * 86_400_000);
    const beats = await heartbeats(db);
    const gaps = await gapsOverlapping(db, from, to, [...beats.keys()]);

    // Past this instant no heal pass reaches back any further, so an incomplete frame is not
    // merely young. Derived from derive's own lookback rather than restated, so shortening one
    // moves the other (`input-completeness.ts` re-exports it for exactly this reason).
    const healDeadline = to.getTime() - HEAL_LOOKBACK_MS;
    const counts = await frameCounts(db, from.getTime(), to.getTime(), healDeadline);
    const frames: WebFrameCoverage[] = FRAME_TIMEFRAMES.map((tf) => {
      const row = counts.find((r) => r.tf === tf);
      return {
        tf,
        // From the window, never from the rows: a count derived from what is stored can never
        // notice that something is not stored.
        expected: expectedFrames(tf, from.getTime(), to.getTime()),
        written: row?.written ?? 0,
        incomplete: row?.incomplete ?? 0,
        explainedOnly: row?.explainedOnly ?? 0,
        unhealed: row?.unhealed ?? 0,
        oldestUnhealed: row?.oldestUnhealedMs ?? null,
      };
    });

    // IB-056. Over the page's own window, not all history: the classification touches every 1m
    // row in its span, and `feature-inputs.repo.ts` records 2,216 ms for a far cheaper unbounded
    // read of this table. The block states its window on the page, and `npm run agg-coverage`
    // answers the same question over everything for anyone who needs the whole backlog.
    const agg = aggCoverage(
      await readAggCoverage(db, {
        fromMs: from.getTime(),
        nowMs: to.getTime(),
        venue: 'binance',
        timeframes: AGG_TIMEFRAMES,
      }),
    );

    return {
      rows,
      collectors: collectorCoverage(beats, gaps, { from, to }),
      unmapped: await unmappedLiquidations(db),
      frames,
      agg,
      windowDays,
    };
  }
}

/**
 * The coverage window in days. Clamped rather than rejected: this drives a display, and a bad
 * query string should not 400 a page that is otherwise fine. 1..365 — beyond a year the gap scan
 * stops being cheap and nothing on the page wants it.
 */
export function clampDays(raw: string | undefined, fallback = 30): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(365, Math.floor(n));
}

/**
 * **The months here are UTC, and that is half of a contract.** `getUTCMonth` below only lines up
 * with the stored months because `monthsWithRows` truncates in UTC too (IB-043). Before that it
 * truncated in the SESSION zone, the two halves disagreed about what a month is, and this
 * function reported a month that held data as missing. If either side ever stops saying UTC
 * explicitly, the bug comes back and neither function looks wrong on its own.
 *
 * Pure: the months between the first and last stored row that hold nothing. Only the interior is
 * reported — a series that simply has not started yet, or has not caught up to today, is not
 * "missing" those months, and saying it is would make every healthy row look broken.
 */
export function missingBetween(present: readonly string[], firstMs: number, lastMs: number | null): string[] {
  const have = new Set(present);
  const out: string[] = [];
  const cursor = new Date(firstMs);
  const end = new Date(lastMs ?? firstMs);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= end.getTime()) {
    const month = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!have.has(month)) out.push(month);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

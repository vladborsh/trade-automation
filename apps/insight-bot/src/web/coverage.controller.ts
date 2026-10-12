import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { WebCoverageResponse, WebCoverageRow } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import { monthsWithRows, seriesExtent, SERIES_TABLES } from '../db/pg/backfill-reads';
import { gapsOverlapping, heartbeats, unmappedLiquidations } from '../db/pg/coverage-reads';
import { collectorCoverage } from './collector-coverage';

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
    if (!this.db) return { rows: [], collectors: [], unmapped: { total: 0, rows: [] }, windowDays };
    const db = this.db;
    const rows: WebCoverageRow[] = [];

    for (const symbol of this.config.symbols) {
      for (const [series, table] of Object.entries(SERIES_TABLES)) {
        const filter = { venue: 'binance', symbol: symbol.binance_perp, market: table.table === 'candles_1m' ? 'perp' : undefined };
        const extent = await seriesExtent(db, table, filter);
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

    return {
      rows,
      collectors: collectorCoverage(beats, gaps, { from, to }),
      unmapped: await unmappedLiquidations(db),
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

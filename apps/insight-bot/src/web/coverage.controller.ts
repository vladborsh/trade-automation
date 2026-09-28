import { Controller, Get, Inject } from '@nestjs/common';
import type { WebCoverageResponse, WebCoverageRow } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import { monthsWithRows, seriesExtent, SERIES_TABLES } from '../db/pg/backfill-reads';

/**
 * architecture/insight-bot-web-dashboard.md §2, §4 — `GET /api/web/coverage`: per symbol × series,
 * the first and last row held and the months missing between them.
 *
 * It reuses IB-012's `backfill-reads.ts` rather than writing its own SQL: the dashboard must show
 * the same coverage the backfill acts on, and two queries answering "what do we hold" would drift.
 * Guarded by IB-029's `APP_GUARD` on `/api/web`, like everything else here.
 */
@Controller('api/web/coverage')
export class WebCoverageController {
  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) private readonly db: Db | null,
  ) {}

  @Get()
  async get(): Promise<WebCoverageResponse> {
    if (!this.db) return { rows: [] };
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

    return { rows };
  }
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

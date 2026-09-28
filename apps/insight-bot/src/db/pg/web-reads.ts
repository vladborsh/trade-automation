import type { WebGapReportCell } from '@trade-automation/contracts';
import type { GapReport } from '../../ops/gap-report';
import type { Db } from '../db.port';

/**
 * IB-030 — the reads the web dashboard needs (SQL stays in `src/db/pg/`, IB-004's rule).
 *
 * Nothing here recomputes anything: the gap grid is built from the reports IB-011 already stored,
 * and coverage reuses `backfill-reads.ts`. A dashboard that re-derived its own numbers would drift
 * from the report the Tester reads, and then two truths would be in circulation.
 */

export interface StoredGapReport {
  day: string;
  clean: boolean;
  report: GapReport;
}

/** The last `days` daily reports, newest first. */
export async function recentGapReports(db: Db, days: number): Promise<StoredGapReport[]> {
  const rows = await db.query<{ day: Date | string; clean: boolean; report: GapReport }>(
    `select day, clean, report from gap_reports order by day desc limit $1`,
    [days],
  );
  return rows.map((row) => ({
    day: typeof row.day === 'string' ? row.day.slice(0, 10) : row.day.toISOString().slice(0, 10),
    clean: row.clean,
    report: row.report,
  }));
}

/**
 * Flattens the stored reports into the grid's cells. One cell per (day, symbol, series); the three
 * series a report covers are named exactly as the report names them, so a reader can match a cell
 * to the report it came from.
 */
export function toGapCells(reports: readonly StoredGapReport[]): WebGapReportCell[] {
  const cells: WebGapReportCell[] = [];
  for (const { day, report } of reports) {
    const sections: Array<[string, { missing: Array<{ symbol: string; missing: number; expected: number }> }]> = [
      ['candles_1m', report.candles],
      ['open_interest_5m', report.openInterest],
      ['long_short_5m', report.longShort],
    ];
    for (const [series, section] of sections) {
      for (const line of section?.missing ?? []) {
        cells.push({ day, symbol: line.symbol, series, missing: line.missing, expected: line.expected });
      }
    }
  }
  return cells;
}

export interface DatabaseHealth {
  sizeBytes: number;
  partitionHorizon: string | null;
  partitionCount: number;
}

/**
 * Size and partition horizon. The horizon is the furthest month a partition exists for — the
 * number that matters, because there is no DEFAULT partition (§3.1, D7): a write past the horizon
 * fails outright rather than landing somewhere harmless.
 */
export async function databaseHealth(db: Db): Promise<DatabaseHealth> {
  const [size] = await db.query<{ size: string }>('select pg_database_size(current_database())::text as size');
  const partitions = await db.query<{ relname: string }>(
    `select c.relname from pg_class c
       join pg_inherits i on i.inhrelid = c.oid
      where c.relkind = 'r' and c.relname ~ '_[0-9]{4}_[0-9]{2}$'
      order by c.relname`,
  );
  const months = partitions
    .map((p) => /_(\d{4})_(\d{2})$/.exec(p.relname))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}-${m[2]}`);

  return {
    sizeBytes: Number(size?.size ?? 0),
    partitionHorizon: months.length > 0 ? months.sort()[months.length - 1] : null,
    partitionCount: partitions.length,
  };
}

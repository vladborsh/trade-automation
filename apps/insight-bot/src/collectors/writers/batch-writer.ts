import { Inject, Injectable } from '@nestjs/common';
import { Db, DbHandle, DB } from '../../db/db.port';
import { MetricsService } from '../../ops/metrics.service';
import * as t from './tables';
import { buildInsert, buildUpsert, chunk, MAX_ROWS_PER_STATEMENT, TableSpec, updatedColumns } from './upsert';

/**
 * architecture/insight-bot-system-design.md §3.1, §2.1 (`collectors/writers`) — one writer per
 * table, batching at most 500 rows per statement, every statement an
 * `INSERT … ON CONFLICT (natural key) DO UPDATE` (D12) so the same batch written twice changes
 * nothing.
 *
 * The SQL comes from the pure builders in `upsert.ts`; this class only chunks, flattens and
 * runs. `write` returns the number of rows it sent, and counts them on
 * `ib_rows_written_total{table}` (§6.1).
 */
export class BatchWriter<TRow> {
  constructor(
    private readonly db: Db,
    private readonly spec: TableSpec,
    private readonly toTuple: (row: TRow) => unknown[],
    private readonly metrics?: MetricsService,
  ) {}

  /**
   * Writes `rows` in batches. Each batch is one statement; a batch that fails throws, and the
   * batches before it stay written — the caller retries the whole set, which is safe precisely
   * because the write is idempotent. Pass a transaction handle to `writeOn` for all-or-nothing.
   */
  async write(rows: readonly TRow[]): Promise<number> {
    return this.writeOn(this.db, rows);
  }

  /** The same write against a caller-supplied handle, e.g. inside `db.transaction(...)`. */
  async writeOn(handle: DbHandle, rows: readonly TRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const tuples = lastPerConflictKey(this.spec, rows.map((row) => this.toTuple(row)));
    for (const batch of chunk(tuples, MAX_ROWS_PER_STATEMENT)) {
      const sql =
        this.spec.conflict.length === 0 ? buildInsert(this.spec, batch.length) : buildUpsert(this.spec, batch.length);
      try {
        await handle.query(sql, batch.flat());
      } catch (error) {
        // IB-BUG-015: the bare Postgres message never said WHICH table refused, so six lost OKX
        // batches were logged as "OKX write failed" with no writer in the line.
        throw new Error(
          `${this.spec.table}: write of ${batch.length} of ${tuples.length} row(s) failed: ${(error as Error).message}`,
          { cause: error },
        );
      }
    }
    this.metrics?.rowsWritten.inc({ table: this.spec.table }, tuples.length);
    return tuples.length;
  }
}

/**
 * IB-BUG-015 — one row per natural key, the LAST one in the batch winning (the same answer two
 * separate upserts in order would give). `ON CONFLICT DO UPDATE` refuses a statement that names
 * one key twice ("cannot affect row a second time"), and a collector buffer legitimately holds
 * repeats: OKX's `funding-rate` channel re-sent the settled rate for the same `prevFundingTime`
 * on every push, so a drain with two pushes for one instrument carried the key twice and the whole
 * batch was refused — 6 times in 14 h on the coordinator, every time `funding_settlements` (that
 * writer is gone since WD-010; the dedupe stays for any batch that can repeat a key, e.g. a poll
 * overlapping a backfill).
 *
 * Deduped here, in the one writer every collector goes through, rather than in each collector:
 * a per-collector fix would leave the next buffer that repeats a key to rediscover the bug.
 * A `DO NOTHING` table (liquidations) and an append-only one (no key) are left alone: Postgres
 * accepts repeats there, keeping the first, and changing which row survives is not this fix.
 */
export function lastPerConflictKey(spec: TableSpec, tuples: readonly unknown[][]): unknown[][] {
  if (spec.conflict.length === 0 || updatedColumns(spec).length === 0) return [...tuples];
  const keyAt = spec.conflict.map((column) => spec.columns.indexOf(column));
  const byKey = new Map<string, unknown[]>();
  for (const tuple of tuples) {
    const key = keyAt.map((i) => keyPart(tuple[i])).join('\u0001');
    byKey.delete(key); // re-inserted below, so the surviving row keeps its latest position
    byKey.set(key, tuple);
  }
  return [...byKey.values()];
}

/** A Date compares by instant (two `new Date(x)` are different objects), everything else by type + value. */
function keyPart(value: unknown): string {
  if (value instanceof Date) return `d${value.getTime()}`;
  if (value === null || value === undefined) return 'n';
  return `${typeof value}:${String(value)}`;
}

/**
 * The writers for what the box still stores (WD-010, storage ruling 2026-11-03): liquidations,
 * Binance OI and long/short, the calendar, and collector gaps. Built once per process. Injectable so a collector asks for the one
 * table it writes; the writers themselves hold no state.
 */
@Injectable()
export class Writers {
  readonly openInterest: BatchWriter<t.OpenInterestRow>;
  readonly longShort: BatchWriter<t.LongShortRow>;
  readonly liquidations: BatchWriter<t.LiquidationRow>;
  readonly calendarEvents: BatchWriter<t.CalendarEventRow>;
  readonly collectorGaps: BatchWriter<t.CollectorGapRow>;

  constructor(
    @Inject(DB) db: Db | null,
    private readonly metrics: MetricsService,
  ) {
    if (db === null) {
      throw new Error('Writers: no database. The collectors require DATABASE_URL; see README.md.');
    }
    this.openInterest = new BatchWriter(db, t.OPEN_INTEREST_5M, t.openInterestTuple, metrics);
    this.longShort = new BatchWriter(db, t.LONG_SHORT_5M, t.longShortTuple, metrics);
    this.liquidations = new BatchWriter(db, t.LIQUIDATIONS, t.liquidationTuple, metrics);
    this.calendarEvents = new BatchWriter(db, t.CALENDAR_EVENTS, t.calendarEventTuple, metrics);
    this.collectorGaps = new BatchWriter(db, t.COLLECTOR_GAPS, t.collectorGapTuple, metrics);
  }
}

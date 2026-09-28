import { Inject, Injectable } from '@nestjs/common';
import { Db, DbHandle, DB } from '../../db/db.port';
import { MetricsService } from '../../ops/metrics.service';
import * as t from './tables';
import { buildInsert, buildUpsert, chunk, MAX_ROWS_PER_STATEMENT, TableSpec } from './upsert';

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
    for (const batch of chunk(rows, MAX_ROWS_PER_STATEMENT)) {
      const sql =
        this.spec.conflict.length === 0 ? buildInsert(this.spec, batch.length) : buildUpsert(this.spec, batch.length);
      await handle.query(sql, batch.flatMap((row) => this.toTuple(row)));
    }
    this.metrics?.rowsWritten.inc({ table: this.spec.table }, rows.length);
    return rows.length;
  }
}

/**
 * The nine §3.3 writers, built once per process. Injectable so a collector asks for the one
 * table it writes; the writers themselves hold no state.
 */
@Injectable()
export class Writers {
  readonly candles1m: BatchWriter<t.Candle1mRow>;
  readonly candlesAgg: BatchWriter<t.CandleAggRow>;
  readonly markFunding: BatchWriter<t.MarkFundingRow>;
  readonly fundingSettlements: BatchWriter<t.FundingSettlementRow>;
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
    this.candles1m = new BatchWriter(db, t.CANDLES_1M, t.candle1mTuple, metrics);
    this.candlesAgg = new BatchWriter(db, t.CANDLES_AGG, t.candleAggTuple, metrics);
    this.markFunding = new BatchWriter(db, t.MARK_FUNDING_1M, t.markFundingTuple, metrics);
    this.fundingSettlements = new BatchWriter(db, t.FUNDING_SETTLEMENTS, t.fundingSettlementTuple, metrics);
    this.openInterest = new BatchWriter(db, t.OPEN_INTEREST_5M, t.openInterestTuple, metrics);
    this.longShort = new BatchWriter(db, t.LONG_SHORT_5M, t.longShortTuple, metrics);
    this.liquidations = new BatchWriter(db, t.LIQUIDATIONS, t.liquidationTuple, metrics);
    this.calendarEvents = new BatchWriter(db, t.CALENDAR_EVENTS, t.calendarEventTuple, metrics);
    this.collectorGaps = new BatchWriter(db, t.COLLECTOR_GAPS, t.collectorGapTuple, metrics);
  }
}

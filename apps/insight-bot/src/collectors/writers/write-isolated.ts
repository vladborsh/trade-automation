/**
 * IB-BUG-015 — several tables written from one drained buffer, each on its own: a writer that
 * throws is reported and the next one still runs.
 *
 * Before this, OKX's `flush()` awaited markFunding → liquidations → settlements in sequence, so a
 * refused markFunding statement skipped that tick's liquidations too — and `drain()` had already
 * emptied the buffer, so they were gone, leaving one error line and no gap row. Sequential rather
 * than `Promise.all` on purpose: it keeps the pool use what it was (one statement at a time per
 * collector) and the order the caller lists is the order rows land.
 */
export interface IsolatedWrite {
  /** The table, as it should appear in the error line. */
  table: string;
  rows: number;
  run: () => Promise<unknown>;
}

/** A write of `rows` to `table`, typed at the call site so a writer cannot be handed the wrong rows. */
export function step<T>(table: string, rows: readonly T[], write: (rows: readonly T[]) => Promise<unknown>): IsolatedWrite {
  return { table, rows: rows.length, run: () => write(rows) };
}

export interface WriteFailure {
  table: string;
  rows: number;
  message: string;
}

export async function writeIsolated(writes: readonly IsolatedWrite[]): Promise<WriteFailure[]> {
  const failures: WriteFailure[] = [];
  for (const { table, rows, run } of writes) {
    if (rows === 0) continue;
    try {
      await run();
    } catch (error) {
      failures.push({ table, rows, message: (error as Error).message });
    }
  }
  return failures;
}

/** One line per failure: which table, how many rows were lost, and Postgres's own reason. */
export function describeFailure(source: string, failure: WriteFailure): string {
  return `${source} write to ${failure.table} failed, ${failure.rows} row(s) not written: ${failure.message}`;
}

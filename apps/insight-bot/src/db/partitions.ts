/**
 * architecture/insight-bot-system-design.md §3.1, D7 — monthly native RANGE partitions, kept
 * three months ahead by a maintenance job, and created on demand for any month the backfill
 * touches. No TimescaleDB.
 *
 * Everything here is pure: a month is a string `YYYY-MM`, and the SQL is built from it. The
 * service that runs the SQL is `partitions.service.ts`.
 */

/** The partitioned tables and the column each is ranged on (migration 002). */
export const PARTITIONED_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'candles_1m', column: 'open_time' },
  { table: 'candles_agg', column: 'open_time' },
  { table: 'mark_funding_1m', column: 'ts' },
  { table: 'open_interest_5m', column: 'ts' },
  { table: 'long_short_5m', column: 'ts' },
  { table: 'liquidations', column: 'ts' },
  { table: 'collector_gaps', column: 'detected_at' },
];

export interface Partition {
  table: string;
  /** `YYYY-MM`. */
  month: string;
  name: string;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  from: string;
  /** Exclusive upper bound, `YYYY-MM-DD` — the first day of the next month. */
  to: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function assertMonth(month: string): void {
  if (!MONTH.test(month)) {
    throw new Error(`Not a YYYY-MM month: '${month}'`);
  }
}

/** The `YYYY-MM` a timestamp falls in, in UTC — the only timezone this app has (§3.1). */
export function monthOf(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function nextMonth(month: string): string {
  assertMonth(month);
  const [year, m] = month.split('-').map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Every month from `from` to `to` inclusive of both ends' months. `to` before `from` yields an
 * empty list rather than throwing: a caller asking for a backwards range wants nothing, and a
 * backfill computing `[lastStored, now]` hits exactly that when it is already up to date.
 */
export function monthsBetween(from: Date, to: Date): string[] {
  if (to.getTime() < from.getTime()) return [];
  const last = monthOf(to);
  const months: string[] = [];
  for (let month = monthOf(from); ; month = nextMonth(month)) {
    months.push(month);
    if (month === last) break;
  }
  return months;
}

/** `now`'s month plus `ahead` further months — D7's "three months ahead" is `ahead = 3`. */
export function monthsAhead(now: Date, ahead: number): string[] {
  if (ahead < 0 || !Number.isInteger(ahead)) {
    throw new Error(`ahead must be a non-negative integer, got ${ahead}`);
  }
  const months = [monthOf(now)];
  for (let i = 0; i < ahead; i += 1) months.push(nextMonth(months[months.length - 1]));
  return months;
}

/** `candles_1m` + `2026-09` → `candles_1m_2026_09`. */
export function partitionName(table: string, month: string): string {
  assertMonth(month);
  return `${table}_${month.replace('-', '_')}`;
}

export function partitionsFor(months: readonly string[], tables = PARTITIONED_TABLES): Partition[] {
  return months.flatMap((month) => {
    assertMonth(month);
    const to = nextMonth(month);
    return tables.map(({ table }) => ({
      table,
      month,
      name: partitionName(table, month),
      from: `${month}-01`,
      to: `${to}-01`,
    }));
  });
}

/**
 * `CREATE TABLE IF NOT EXISTS … PARTITION OF … FOR VALUES FROM … TO …`.
 *
 * The identifiers are interpolated, not bound: Postgres takes no parameters in DDL. They are
 * safe because both come from this module — a table name from `PARTITIONED_TABLES` and a month
 * that `assertMonth` has matched against `^\d{4}-(0[1-9]|1[0-2])$`. `buildCreatePartition`
 * re-checks both rather than trusting its caller, so no path can reach here with free text.
 */
export function buildCreatePartition(partition: Partition, tables = PARTITIONED_TABLES): string {
  assertMonth(partition.month);
  if (!tables.some((t) => t.table === partition.table)) {
    throw new Error(`Not a partitioned table: '${partition.table}'`);
  }
  if (partition.name !== partitionName(partition.table, partition.month)) {
    throw new Error(`Partition name '${partition.name}' does not match ${partition.table} / ${partition.month}`);
  }
  // The bounds carry an EXPLICIT +00. Every partition key here is `timestamptz`, and Postgres
  // resolves a bare literal like '2026-08-01' in the SESSION's timezone — so on a box whose
  // Postgres session is not UTC the whole partition slides (measured: US/Pacific shifted every
  // month by 7 hours, leaving 00:00–07:00Z on the 1st of each month with no partition at all).
  // The app's own TZ=UTC does not help: this is the database session's zone, not the process's.
  return (
    `create table if not exists ${partition.name} partition of ${partition.table} ` +
    `for values from ('${partition.from} 00:00:00+00') to ('${partition.to} 00:00:00+00')`
  );
}

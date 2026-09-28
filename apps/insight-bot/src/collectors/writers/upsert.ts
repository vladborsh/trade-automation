/**
 * architecture/insight-bot-system-design.md §3.1 — "every write is an `INSERT … ON CONFLICT
 * (natural key) DO UPDATE` unless stated. Batched (≤ 500 rows per statement) by the writers
 * module." D12: the natural key is the idempotency key, so a reconnect that replays a frame,
 * or a backfill overlapping live data, updates a row instead of duplicating it.
 *
 * Pure SQL builders; `batch-writer.ts` is what runs them.
 */

/** §3.1's cap. A row here is a handful of numerics, so 500 rows is a few thousand parameters. */
export const MAX_ROWS_PER_STATEMENT = 500;

export interface TableSpec {
  table: string;
  /** Insert columns, in the order the row tuples supply them. */
  columns: readonly string[];
  /** The natural key — `ON CONFLICT (…)`. */
  conflict: readonly string[];
  /**
   * Columns updated on conflict. Defaults to every column that is not part of the key.
   * An empty list means `DO NOTHING` — for an append-only table whose rows never change.
   */
  update?: readonly string[];
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(name: string, what: string): void {
  // Every identifier here comes from a TableSpec constant in this module's own directory, never
  // from a payload. Checked anyway: these are interpolated into SQL, because Postgres takes no
  // parameters for identifiers.
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid ${what}: '${name}'`);
}

export function updatedColumns(spec: TableSpec): readonly string[] {
  return spec.update ?? spec.columns.filter((c) => !spec.conflict.includes(c));
}

/**
 * The statement for `rowCount` rows: `insert into t (a, b) values ($1, $2), ($3, $4) on conflict …`.
 * Parameters are numbered across the whole batch, so the caller flattens its rows in the same
 * column order.
 */
export function buildUpsert(spec: TableSpec, rowCount: number): string {
  if (spec.conflict.length === 0) {
    throw new Error(`${spec.table} declares no natural key; use buildInsert for an append-only table`);
  }
  for (const column of spec.conflict) {
    if (!spec.columns.includes(column)) {
      throw new Error(`Conflict column '${column}' is not among ${spec.table}'s insert columns`);
    }
  }

  const updates = updatedColumns(spec);
  for (const column of updates) assertIdentifier(column, 'column');
  const onConflict =
    updates.length === 0
      ? 'do nothing'
      : `do update set ${updates.map((c) => `${c} = excluded.${c}`).join(', ')}`;

  return `${buildInsert(spec, rowCount)} on conflict (${spec.conflict.join(', ')}) ${onConflict}`;
}

/**
 * The plain multi-row insert, for an append-only table with no natural key (`collector_gaps`:
 * every row is a new observation, and `id` is a bigserial the insert never supplies).
 */
export function buildInsert(spec: TableSpec, rowCount: number): string {
  if (!Number.isInteger(rowCount) || rowCount < 1) {
    throw new Error(`rowCount must be a positive integer, got ${rowCount}`);
  }
  if (rowCount > MAX_ROWS_PER_STATEMENT) {
    throw new Error(`rowCount ${rowCount} exceeds the ${MAX_ROWS_PER_STATEMENT}-row cap; chunk first`);
  }
  assertIdentifier(spec.table, 'table');
  for (const column of spec.columns) assertIdentifier(column, 'column');

  const width = spec.columns.length;
  const tuples: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const placeholders = Array.from({ length: width }, (_, i) => `$${row * width + i + 1}`);
    tuples.push(`(${placeholders.join(', ')})`);
  }
  return `insert into ${spec.table} (${spec.columns.join(', ')}) values ${tuples.join(', ')}`;
}

/** Splits `rows` into batches of at most `size` — the last one short. An empty input gives no batches. */
export function chunk<T>(rows: readonly T[], size = MAX_ROWS_PER_STATEMENT): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk size must be a positive integer, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * architecture/backtest-app-system-design.md §4 — one `Db` port behind which every repository
 * (users, invites, auth sessions, backtest sessions, orders, ...) is built. No SQL outside
 * `src/db/pg/` and `src/**\/pg/` directories (T-004 scope note) — this file and its `pg/`
 * implementation are the only place a query string is allowed to originate from a raw string;
 * every other module calls through a repository port.
 */

/** A single query result row set, already at the JS-native boundary (see PgDatabase). */
export type QueryResult<T> = T[];

/**
 * The subset of capability a transactional or non-transactional handle exposes. Repositories
 * are written against this, not against `Db` directly, so the same repository code runs inside
 * or outside a transaction.
 */
export interface DbHandle {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends DbHandle {
  /**
   * Runs `fn` against a dedicated connection inside `BEGIN`/`COMMIT`; a thrown error (including
   * one thrown by `fn`) rolls back. `tx` exposes the same `query` shape as `Db` itself.
   */
  transaction<T>(fn: (tx: DbHandle) => Promise<T>): Promise<T>;
}

export const DB = Symbol('DB');

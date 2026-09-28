/**
 * architecture/insight-bot-system-design.md §2.1, §3 — one `Db` port behind which every
 * repository (symbols, playbook config, the market-data writers, users, ...) is built. Lifted
 * unchanged from signal-server's `src/db/db.port.ts`, which states the rule this app keeps: no
 * SQL outside `src/db/pg/` and `src/**\/pg/` directories and the writers module (§2.1); every
 * other module calls through a repository port.
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

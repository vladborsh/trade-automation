import { Logger } from '@nestjs/common';
import { Pool, PoolClient, types as pgTypes } from 'pg';
import { Db, DbHandle } from '../db.port';

const NUMERIC_OID = 1700; // numeric/decimal — pg returns this as a string by default.
const INT8_OID = 20; // bigint — pg also returns this as a string by default.

/**
 * architecture/insight-bot-system-design.md §3.1 — prices and quantities are `numeric`, which
 * the `pg` driver returns as strings; the repositories want `number`, parsed at the boundary,
 * once. Lifted unchanged from signal-server's `src/db/pg/pg-database.ts`. Done once, here,
 * for every query through this pool, rather than in each repository. `bigint` gets the same
 * treatment: a `bigint` column in this codebase is a ms-epoch timestamp (the `number`
 * convention of `libs/contracts/src/candle.ts`), never a value near `Number.MAX_SAFE_INTEGER`,
 * so parsing it to `number` here keeps repositories from having to re-parse it themselves.
 */
function installTypeParsers(): void {
  pgTypes.setTypeParser(NUMERIC_OID, (value: string) => (value === null ? null : Number(value)));
  pgTypes.setTypeParser(INT8_OID, (value: string) => (value === null ? null : Number(value)));
}

/**
 * BUG-013 — a Postgres connection error, logged without the connection string: the pg error code
 * (e.g. 57P01 "terminating connection due to administrator command") and message only.
 */
export function describePgError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  return `${e.code ?? 'no code'}: ${e.message ?? String(err)}`;
}

class PgHandle implements DbHandle {
  constructor(private readonly runner: { query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }> }) {}

  async query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    const result = await this.runner.query(sql, params);
    return result.rows as T[];
  }
}

/**
 * `pg` `Pool`-backed implementation of the `Db` port. One instance per process, built by
 * `db.module.ts` from `DATABASE_URL`. `transaction` checks out a dedicated client so
 * concurrent transactions do not interleave statements on the pool's shared connections.
 */
export class PgDatabase implements Db {
  private readonly logger = new Logger(PgDatabase.name);
  private readonly pool: Pool;
  private readonly handle: DbHandle;

  constructor(connectionString: string) {
    installTypeParsers();
    this.pool = new Pool({ connectionString });
    // BUG-013: node-postgres re-emits an idle client's error (a Postgres restart,
    // pg_terminate_backend, a network drop) on the pool. Without a listener that is an unhandled
    // 'error' and the process exits. The pool has already removed the broken client; the next
    // checkout opens a fresh connection.
    this.pool.on('error', (err) => this.logger.warn(`idle Postgres connection lost (${describePgError(err)}); the pool will reconnect`));
    this.handle = new PgHandle(this.pool);
  }

  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    return this.handle.query<T>(sql, params);
  }

  async transaction<T>(fn: (tx: DbHandle) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    // BUG-013: a checked-out client is outside the pool's idle listener, so its connection error
    // needs one of its own. The failing query rejects anyway (the request answers 5xx); the client
    // is then released with the error, so the pool destroys it instead of reusing it.
    let broken: Error | undefined;
    const onError = (err: Error) => {
      broken = err;
      this.logger.warn(`Postgres connection lost mid-transaction (${describePgError(err)})`);
    };
    client.on('error', onError);
    try {
      await client.query('BEGIN');
      const result = await fn(new PgHandle(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.off('error', onError);
      client.release(broken);
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

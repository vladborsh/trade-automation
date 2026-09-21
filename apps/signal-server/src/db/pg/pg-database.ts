import { Pool, PoolClient, types as pgTypes } from 'pg';
import { Db, DbHandle } from '../db.port';

const NUMERIC_OID = 1700; // numeric/decimal — pg returns this as a string by default.
const INT8_OID = 20; // bigint — pg also returns this as a string by default.

/**
 * architecture/backtest-app-system-design.md §3 — "the `pg` driver returns `numeric` as
 * strings — the repositories parse them to `number` at the boundary, once." Done once, here,
 * for every query through this pool, rather than in each repository. `bigint` gets the same
 * treatment: every `bigint` column in this schema is a ms-epoch timestamp (the whole
 * codebase's `number` convention — see `libs/contracts/src/candle.ts`), never a value near
 * `Number.MAX_SAFE_INTEGER`, so parsing it to `number` here keeps repositories from having to
 * re-parse it themselves.
 */
function installTypeParsers(): void {
  pgTypes.setTypeParser(NUMERIC_OID, (value: string) => (value === null ? null : Number(value)));
  pgTypes.setTypeParser(INT8_OID, (value: string) => (value === null ? null : Number(value)));
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
  private readonly pool: Pool;
  private readonly handle: DbHandle;

  constructor(connectionString: string) {
    installTypeParsers();
    this.pool = new Pool({ connectionString });
    this.handle = new PgHandle(this.pool);
  }

  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    return this.handle.query<T>(sql, params);
  }

  async transaction<T>(fn: (tx: DbHandle) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PgHandle(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

import type { Db, DbHandle } from '../db.port';

/**
 * IB-125 — a transaction handle as a `Db`: a repository's own `transaction` becomes a SAVEPOINT inside the outer
 * one. A history run's dry run replays inside ONE transaction that it rolls back, while the repository it drives
 * (`PgFundingAlertStore.commit`) opens a transaction per check; this lets the same repository code run in both.
 * A throw inside rolls back to the savepoint and rethrows, as a real transaction would.
 */
export function savepointDb(tx: DbHandle): Db {
  let n = 0;
  return {
    query: (sql, params) => tx.query(sql, params),
    async transaction<T>(fn: (h: DbHandle) => Promise<T>): Promise<T> {
      const name = `sp_${++n}`;
      await tx.query(`savepoint ${name}`);
      try {
        const out = await fn(tx);
        await tx.query(`release savepoint ${name}`);
        return out;
      } catch (error) {
        await tx.query(`rollback to savepoint ${name}`);
        throw error;
      }
    },
  };
}

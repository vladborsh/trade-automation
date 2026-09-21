import { Db, DbHandle } from '../../db/db.port';
import { BacktestRepositories } from '../session.repository.port';
import { PgOpsRepository } from './pg-ops.repository';
import { PgOrderRepository } from './pg-order.repository';
import { PgSessionRepository } from './pg-session.repository';

type BoundRepositories = Omit<BacktestRepositories, 'transaction'>;

function bind(handle: DbHandle): BoundRepositories {
  return {
    sessions: new PgSessionRepository(handle),
    orders: new PgOrderRepository(handle),
    ops: new PgOpsRepository(handle),
  };
}

/** PostgreSQL implementation of `BacktestRepositories` over the `Db` port. */
export class PgBacktestRepositories implements BacktestRepositories {
  readonly sessions: PgSessionRepository;
  readonly orders: PgOrderRepository;
  readonly ops: PgOpsRepository;

  constructor(private readonly db: Db) {
    this.sessions = new PgSessionRepository(db);
    this.orders = new PgOrderRepository(db);
    this.ops = new PgOpsRepository(db);
  }

  transaction<T>(fn: (repos: BoundRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(bind(tx)));
  }
}

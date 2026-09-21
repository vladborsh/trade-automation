import { Costs, SessionAggregates, SessionLayout, SessionSummary, Timeframe } from '@trade-automation/contracts';
import { OpsRepository } from './ops.repository.port';
import { OrderRepository } from './order.repository.port';

/** What POST /backtest/sessions writes (§7.2): the validated request plus the derived fields. */
export interface NewSession {
  name: string;
  sessionCurrency: string;
  timeframe: Timeframe;
  periodFromMs: number;
  periodToMs: number;
  initialBalance: number;
  defaultRiskPct: number;
  costs: Costs;
  skipWeekends: boolean;
  notionalWarnMultiple: number;
  layout: SessionLayout;
}

/**
 * architecture/backtest-app-system-design.md §3, §4 — `backtest_sessions`. Every method takes
 * the owning `userId` and filters on it (tenancy, §3): a row owned by someone else is
 * indistinguishable from a missing one, which is how the API answers 404 rather than 403.
 * Rows come back in the `SessionSummary` wire shape (config + stored aggregates).
 */
export interface SessionRepository {
  insert(userId: string, session: NewSession): Promise<SessionSummary>;
  /** Newest first (the `(user_id, created_at desc)` index). */
  listByUser(userId: string): Promise<SessionSummary[]>;
  /** `forUpdate` row-locks it for the rest of the enclosing transaction. */
  findById(userId: string, id: string, opts?: { forUpdate?: boolean }): Promise<SessionSummary | null>;
  /** Bumps `updated_at`; null when no such session for this user. */
  update(userId: string, id: string, patch: { name?: string; timeframe?: Timeframe }): Promise<SessionSummary | null>;
  /** True when a row was deleted; cascades to orders, modifications, screenshots, ops (§3). */
  delete(userId: string, id: string): Promise<boolean>;
  /**
   * A trade close (§5.5 step 4, decision 38): writes the new realized balance and the aggregate
   * columns (`toSessionAggregates(computeStats(…))`). Call inside the closing transaction.
   */
  applyTradeClose(userId: string, id: string, balance: number, aggregates: SessionAggregates): Promise<SessionSummary | null>;
  /**
   * §5.5 steps 1 and 5: move the cursor; with `complete`, also set `status='complete'` and
   * `completed_at` (decision 28). Call inside the advancing transaction.
   */
  advanceCursor(userId: string, id: string, cursorMs: number, complete: boolean): Promise<SessionSummary | null>;
}

export interface BacktestRepositories {
  sessions: SessionRepository;
  orders: OrderRepository;
  ops: OpsRepository;
  transaction<T>(fn: (repos: Omit<BacktestRepositories, 'transaction'>) => Promise<T>): Promise<T>;
}

/** Resolves to `null` when the DB module is disabled (no `DATABASE_URL`). */
export const BACKTEST_REPOSITORIES = Symbol('BACKTEST_REPOSITORIES');

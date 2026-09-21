import type { StatsOrder } from '@trade-automation/replay-core';

/**
 * architecture/backtest-app-system-design.md §3, §4 — `orders`. Read side only for now: the
 * session detail recomputes its stats from the orders table (decision 38). T-015 extends this
 * port with order persistence (place, cancel, close, list, get).
 *
 * Tenancy: methods take a `sessionId` the caller has already resolved for the cookie user through
 * `SessionRepository.findById(userId, …)`; this port never sees a session id straight from a URL.
 */
export interface OrderRepository {
  /** The session's closed orders, with just the fields `computeStats` reads. Ordered by `seq`. */
  listClosedForStats(sessionId: string): Promise<StatsOrder[]>;
}

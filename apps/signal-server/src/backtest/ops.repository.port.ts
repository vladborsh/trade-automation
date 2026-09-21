/**
 * architecture/backtest-app-system-design.md §3 `backtest_ops`, D9 — every mutating backtest
 * request carries a client `opId`; the response of the first request that carried it is stored,
 * and a repeat replays it instead of mutating again. Call both methods inside the same
 * transaction as the mutation, after locking the session row, so two concurrent requests with one
 * `opId` serialise and the second finds the first's response.
 */
export interface OpsRepository {
  /** The stored response, or null when this `opId` has not been seen for the session. */
  find(sessionId: string, opId: string): Promise<unknown | null>;
  save(sessionId: string, opId: string, response: unknown): Promise<void>;
}

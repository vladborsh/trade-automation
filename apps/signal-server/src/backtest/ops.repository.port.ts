import type { OpKind } from './op-fingerprint';

/** A stored op: its response, and (since migration 003, BUG-004) what request produced it. */
export interface StoredOp {
  response: unknown;
  /** null on rows written before migration 003 */
  kind: OpKind | null;
  /** null on rows written before migration 003 — such a row replays as before */
  fingerprint: string | null;
}

/**
 * architecture/backtest-app-system-design.md §3 `backtest_ops`, D9 — every mutating backtest
 * request carries a client `opId`; the response of the first request that carried it is stored,
 * with the operation kind and request fingerprint (BUG-004), and a repeat of the same request
 * replays it instead of mutating again. Call both methods inside the same transaction as the
 * mutation, after locking the session row, so two concurrent requests with one `opId` serialise
 * and the second finds the first's row.
 */
export interface OpsRepository {
  /** The stored op, or null when this `opId` has not been seen for the session. */
  find(sessionId: string, opId: string): Promise<StoredOp | null>;
  save(sessionId: string, opId: string, op: { kind: OpKind; fingerprint: string }, response: unknown): Promise<void>;
}

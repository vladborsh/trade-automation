import { HttpStatus, NotFoundException } from '@nestjs/common';
import { SessionSummary } from '@trade-automation/contracts';
import { z } from 'zod';
import { apiError } from '../auth/auth-error';
import { OpKind, opFingerprint } from './op-fingerprint';
import { BacktestRepositories } from './session.repository.port';

export type TxRepos = Omit<BacktestRepositories, 'transaction'>;

/** One mutating request: its `opId`, the operation, the (parsed) body and the target order if any. */
export interface MutationOp {
  opId: string;
  kind: OpKind;
  request: object;
  orderId?: string;
}

const UuidSchema = z.string().uuid();

/** Postgres SQLSTATE 22003 `numeric_value_out_of_range` ("numeric field overflow"). */
const PG_NUMERIC_OUT_OF_RANGE = '22003';

export const VALUE_OUT_OF_RANGE_MESSAGE =
  'A balance, PnL or R in this session would exceed the numeric limit (values must stay below 1e12); create a new session.';

/**
 * architecture/backtest-app-system-design.md D9, §5.5 — the one shape of every mutating backtest
 * request (place, cancel, close, advance). In one transaction:
 *
 * 1. lock the session row (`FOR UPDATE`) for the cookie user — 404 when absent or someone else's;
 * 2. when this `opId` was seen before: the **same request** (same kind and fingerprint, BUG-004)
 *    gets its stored response back, with no second mutation; a **different** request under that
 *    `opId` is a 409 `OP_ID_REUSED` and nothing happens; a row from before migration 003 (no
 *    fingerprint) replays as it always did;
 * 3. otherwise run `fn` and store its response, kind and fingerprint with the mutation.
 *
 * Because every mutation takes the same row lock, order ops and advances on one session
 * serialise: neither ever sees the other half-applied (the second-tab guard, §5.5). A refusal
 * stores nothing, so a retry after it re-validates.
 *
 * T-059: a value that does not fit its numeric column (pg 22003, §12.9's < 1e12 limit) is a
 * terminal 422 `VALUE_OUT_OF_RANGE`, not a 500 the client would retry forever. It is mapped after
 * the rollback: nothing was written, the ops row included.
 */
export function runSessionMutation<T>(
  repos: BacktestRepositories,
  userId: string,
  sessionId: string,
  op: MutationOp,
  fn: (tx: TxRepos, session: SessionSummary) => Promise<T>,
): Promise<T> {
  if (!UuidSchema.safeParse(sessionId).success) return Promise.reject(sessionNotFound());
  const fingerprint = opFingerprint(op.kind, op.request, op.orderId);
  return repos.transaction(async (tx) => {
    const session = await tx.sessions.findById(userId, sessionId, { forUpdate: true });
    if (!session) throw sessionNotFound();
    const stored = await tx.ops.find(session.id, op.opId);
    if (stored !== null) {
      if (stored.fingerprint !== null && (stored.kind !== op.kind || stored.fingerprint !== fingerprint)) {
        throw apiError(HttpStatus.CONFLICT, 'OP_ID_REUSED', 'opId already used for a different request');
      }
      return stored.response as T;
    }
    const response = await fn(tx, session);
    await tx.ops.save(session.id, op.opId, { kind: op.kind, fingerprint }, response);
    return response;
  }).catch((err: unknown) => {
    if (isNumericOverflow(err)) throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, 'VALUE_OUT_OF_RANGE', VALUE_OUT_OF_RANGE_MESSAGE);
    throw err;
  });
}

function isNumericOverflow(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === PG_NUMERIC_OUT_OF_RANGE;
}

export function sessionNotFound(): NotFoundException {
  return new NotFoundException('Session not found.');
}

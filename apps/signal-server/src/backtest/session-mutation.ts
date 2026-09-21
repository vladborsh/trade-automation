import { NotFoundException } from '@nestjs/common';
import { SessionSummary } from '@trade-automation/contracts';
import { z } from 'zod';
import { BacktestRepositories } from './session.repository.port';

export type TxRepos = Omit<BacktestRepositories, 'transaction'>;

const UuidSchema = z.string().uuid();

/**
 * architecture/backtest-app-system-design.md D9, §5.5 — the one shape of every mutating backtest
 * request (place, cancel, close, advance). In one transaction:
 *
 * 1. lock the session row (`FOR UPDATE`) for the cookie user — 404 when absent or someone else's;
 * 2. when this `opId` was seen before, return its stored response (no second mutation);
 * 3. otherwise run `fn` and store its response with the mutation.
 *
 * Because every mutation takes the same row lock, order ops and advances on one session
 * serialise: neither ever sees the other half-applied (the second-tab guard, §5.5). A refusal
 * stores nothing, so a retry after it re-validates.
 */
export function runSessionMutation<T>(
  repos: BacktestRepositories,
  userId: string,
  sessionId: string,
  opId: string,
  fn: (tx: TxRepos, session: SessionSummary) => Promise<T>,
): Promise<T> {
  if (!UuidSchema.safeParse(sessionId).success) return Promise.reject(sessionNotFound());
  return repos.transaction(async (tx) => {
    const session = await tx.sessions.findById(userId, sessionId, { forUpdate: true });
    if (!session) throw sessionNotFound();
    const stored = await tx.ops.find(session.id, opId);
    if (stored !== null) return stored as T;
    const response = await fn(tx, session);
    await tx.ops.save(session.id, opId, response);
    return response;
  });
}

export function sessionNotFound(): NotFoundException {
  return new NotFoundException('Session not found.');
}

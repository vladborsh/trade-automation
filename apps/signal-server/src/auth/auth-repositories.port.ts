import { AuthSessionRepository } from './auth-session.repository.port';
import { InviteRepository } from './invite.repository.port';
import { UserRepository } from './user.repository.port';

/**
 * The three auth repositories plus a unit of work that hands out copies bound to one
 * transaction (architecture/backtest-app-system-design.md §4: "`db.transaction(async (tx) =>
 * { ...repos bound to tx... })`"). Invite acceptance — claim, create user, record `used_by` —
 * is one such transaction.
 */
export interface AuthRepositories {
  users: UserRepository;
  invites: InviteRepository;
  sessions: AuthSessionRepository;
  transaction<T>(fn: (repos: Omit<AuthRepositories, 'transaction'>) => Promise<T>): Promise<T>;
}

/** Resolves to `null` when the DB module is disabled (no `DATABASE_URL`). */
export const AUTH_REPOSITORIES = Symbol('AUTH_REPOSITORIES');

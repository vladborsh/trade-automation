import { UserRecord } from './user.repository.port';

/** An `auth_sessions` row joined with its user (architecture/backtest-app-system-design.md §3). */
export interface AuthSessionWithUser {
  id: string;
  expiresAtMs: number;
  lastSeenAtMs: number;
  user: UserRecord;
}

export interface AuthSessionRepository {
  insert(session: { id: string; userId: string; expiresAtMs: number; nowMs: number; userAgent: string | null }): Promise<void>;
  /** The session and its user; null when absent. Expiry is the caller's decision. */
  findWithUser(id: string): Promise<AuthSessionWithUser | null>;
  /** Sliding expiry: `last_seen_at = now`, `expires_at = expiresAtMs`. */
  touch(id: string, nowMs: number, expiresAtMs: number): Promise<void>;
  delete(id: string): Promise<void>;
  /** Housekeeping on login: drop this user's expired rows so the table does not grow forever. */
  deleteExpiredForUser(userId: string, nowMs: number): Promise<void>;
}

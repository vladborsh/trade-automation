/**
 * IB-078 — web_credentials, web_login_events and the credentials use of web_login_tokens
 * (migration 021; architecture/password-login-design-2026-11-02.md P3, P4, P10). SQL under `pg/`,
 * IB-004's rule.
 *
 * As in auth.repo.ts, the database decides the races, not a read-then-write:
 * - a credentials token is consumed by the same conditional UPDATE as before, inside the transaction
 *   that saves the password, so a failed save (a taken login) rolls the consumption back;
 * - a taken login is the UNIQUE constraint's verdict (`LoginTakenError`), never a prior SELECT.
 */
import type { WebLoginOutcome } from '@trade-automation/contracts';
import type { Db, DbHandle } from '../../../db/db.port';
import type { LoginTokenClaim } from './auth.repo';

export interface CredentialsRow {
  userId: number;
  login: string;
  passwordHash: string;
}

export interface CredentialsWithUser extends CredentialsRow {
  disabled: boolean;
}

/** Raised when the login is already someone else's; the surrounding transaction rolls back. */
export class LoginTakenError extends Error {
  constructor() {
    super('LOGIN_TAKEN');
  }
}

const UNIQUE_VIOLATION = '23505';
const LOGIN_UNIQUE = 'web_credentials_login_key';

export async function findCredentialsByLogin(db: DbHandle, login: string): Promise<CredentialsWithUser | null> {
  const rows = await db.query<{ user_id: number; login: string; password_hash: string; disabled: boolean }>(
    `select c.user_id, c.login, c.password_hash, u.disabled
       from web_credentials c join users u on u.id = c.user_id
      where c.login = $1`,
    [login],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { userId: r.user_id, login: r.login, passwordHash: r.password_hash, disabled: r.disabled };
}

export async function findCredentialsByUser(db: DbHandle, userId: number): Promise<CredentialsRow | null> {
  const rows = await db.query<{ user_id: number; login: string; password_hash: string }>(
    'select user_id, login, password_hash from web_credentials where user_id = $1',
    [userId],
  );
  return rows.length === 0 ? null : { userId: rows[0].user_id, login: rows[0].login, passwordHash: rows[0].password_hash };
}

/**
 * Creates the member's credentials, or — when they already have some (a reset, or a second tab that
 * got there first) — replaces only the password. The login of an existing row is never changed.
 * Returns whether this was the first time (`password_set`) or a reset (`password_reset`).
 */
export async function saveCredentials(
  db: DbHandle, userId: number, login: string, passwordHash: string, now: Date,
): Promise<{ created: boolean; login: string }> {
  try {
    const rows = await db.query<{ login: string; created: boolean }>(
      `insert into web_credentials (user_id, login, password_hash, password_changed_at)
            values ($1, $2, $3, $4)
       on conflict (user_id) do update
             set password_hash = excluded.password_hash, password_changed_at = excluded.password_changed_at
       returning login, (xmax = 0) as created`,
      [userId, login, passwordHash, now],
    );
    return { created: rows[0].created, login: rows[0].login };
  } catch (error) {
    const e = error as { code?: string; constraint?: string };
    if (e.code === UNIQUE_VIOLATION && e.constraint === LOGIN_UNIQUE) throw new LoginTakenError();
    throw error;
  }
}

export async function updatePasswordHash(db: DbHandle, userId: number, passwordHash: string, now: Date): Promise<void> {
  await db.query('update web_credentials set password_hash = $2, password_changed_at = $3 where user_id = $1', [userId, passwordHash, now]);
}

/** What `GET /credentials?t=` may say about a token without spending it. */
export async function peekLoginToken(db: DbHandle, tokenHash: string, now: Date): Promise<LoginTokenClaim> {
  const rows = await db.query<{ user_id: number; used_at: Date | null; expires_at: Date }>(
    'select user_id, used_at, expires_at from web_login_tokens where token_hash = $1',
    [tokenHash],
  );
  if (rows.length === 0) return { kind: 'unknown' };
  if (rows[0].used_at !== null) return { kind: 'used' };
  if (new Date(rows[0].expires_at).getTime() <= now.getTime()) return { kind: 'expired' };
  return { kind: 'ok', userId: rows[0].user_id };
}

/** P3: issuing a new link deletes that member's unused ones, so only the newest link works. */
export async function deleteUnusedTokensForUser(db: DbHandle, userId: number): Promise<number> {
  const rows = await db.query<{ token_hash: string }>(
    'delete from web_login_tokens where user_id = $1 and used_at is null returning token_hash',
    [userId],
  );
  return rows.length;
}

/** P9 change-password: every session of the member except the one making the change. */
export async function deleteOtherSessions(db: DbHandle, userId: number, keepSessionId: string): Promise<number> {
  const rows = await db.query<{ id: string }>(
    'delete from web_sessions where user_id = $1 and id <> $2 returning id',
    [userId, keepSessionId],
  );
  return rows.length;
}

export async function deleteAllSessions(db: DbHandle, userId: number): Promise<number> {
  const rows = await db.query<{ id: string }>('delete from web_sessions where user_id = $1 returning id', [userId]);
  return rows.length;
}

export const LOGIN_ATTEMPTED_MAX = 64;
export const USER_AGENT_MAX = 256;

export interface LoginEventInput {
  userId: number | null;
  loginAttempted: string | null;
  outcome: WebLoginOutcome;
  ip: string | null;
  userAgent: string | null;
}

/** P10. Strings are truncated here, at the one place a row is written. There is no password column. */
export async function recordLoginEvent(db: DbHandle, e: LoginEventInput, at: Date): Promise<void> {
  await db.query(
    `insert into web_login_events (at, user_id, login_attempted, outcome, ip, user_agent)
          values ($1, $2, $3, $4, $5, $6)`,
    [at, e.userId, truncate(e.loginAttempted, LOGIN_ATTEMPTED_MAX), e.outcome, truncate(e.ip, 64), truncate(e.userAgent, USER_AGENT_MAX)],
  );
}

export interface LoginEventRow {
  id: number;
  at: Date;
  userId: number | null;
  loginAttempted: string | null;
  outcome: WebLoginOutcome;
  ip: string | null;
  userAgent: string | null;
}

export async function listLoginEvents(db: DbHandle, limit: number): Promise<LoginEventRow[]> {
  const rows = await db.query<{
    id: string; at: Date; user_id: number | null; login_attempted: string | null; outcome: WebLoginOutcome;
    ip: string | null; user_agent: string | null;
  }>(
    `select id, at, user_id, login_attempted, outcome, ip, user_agent
       from web_login_events order by at desc, id desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: Number(r.id), at: new Date(r.at), userId: r.user_id, loginAttempted: r.login_attempted,
    outcome: r.outcome, ip: r.ip, userAgent: r.user_agent,
  }));
}

/** P10: the journal keeps 90 days. Called from `sweepExpired`. */
export const LOGIN_EVENTS_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function sweepLoginEvents(db: Db | DbHandle, now: Date): Promise<number> {
  const rows = await db.query<{ id: string }>(
    'delete from web_login_events where at < $1 returning id',
    [new Date(now.getTime() - LOGIN_EVENTS_RETENTION_MS)],
  );
  return rows.length;
}

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  return [...value].slice(0, max).join('');
}

/** Whether the member exists and is enabled; a credentials link of a disabled member is refused. */
export async function isUserEnabled(db: DbHandle, userId: number): Promise<boolean> {
  const rows = await db.query<{ disabled: boolean }>('select disabled from users where id = $1', [userId]);
  return rows.length > 0 && !rows[0].disabled;
}

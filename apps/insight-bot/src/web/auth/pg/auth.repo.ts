/**
 * IB-029 — the web-auth repository (SQL under a `pg/` directory, IB-004's rule).
 *
 * Two conditional UPDATEs carry the security of this feature, and both are written so the
 * database decides, not the application:
 *
 * - `consumeLoginToken` claims the token with `where used_at is null and expires_at > now`, so
 *   a link opened twice (or forwarded) cannot mint a second session.
 * - `touchSession` slides the expiry only when the row is really still valid.
 */

import type { Db, DbHandle } from '../../../db/db.port';
import type { User } from '../../../users/user.model';

export interface LoginTokenClaim {
  kind: 'ok' | 'used' | 'expired' | 'unknown';
  userId?: number;
}

export async function createLoginToken(db: DbHandle, tokenHash: string, userId: number, expiresAt: Date): Promise<void> {
  await db.query(
    'insert into web_login_tokens (token_hash, user_id, expires_at) values ($1, $2, $3)',
    [tokenHash, userId, expiresAt],
  );
}

/**
 * Spends a login token, once. The three failure kinds are distinguished for the holder's sake
 * (§4: 401 TOKEN_INVALID vs 410 TOKEN_USED / TOKEN_EXPIRED) — a 256-bit token is not something
 * an outsider enumerates, so naming the cause helps the person who clicked their own stale link.
 */
export async function consumeLoginToken(db: DbHandle, tokenHash: string, now: Date): Promise<LoginTokenClaim> {
  const claimed = await db.query<{ user_id: number }>(
    `update web_login_tokens set used_at = $2
      where token_hash = $1 and used_at is null and expires_at > $2
      returning user_id`,
    [tokenHash, now],
  );
  if (claimed.length > 0) return { kind: 'ok', userId: claimed[0].user_id };

  // it did not claim: say why, from the row itself
  const rows = await db.query<{ used_at: Date | null; expires_at: Date }>(
    'select used_at, expires_at from web_login_tokens where token_hash = $1',
    [tokenHash],
  );
  if (rows.length === 0) return { kind: 'unknown' };
  if (rows[0].used_at !== null) return { kind: 'used' };
  return { kind: 'expired' };
}

export async function createSession(db: DbHandle, id: string, userId: number, expiresAt: Date): Promise<void> {
  await db.query(
    'insert into web_sessions (id, user_id, expires_at) values ($1, $2, $3)',
    [id, userId, expiresAt],
  );
}

export interface SessionRow {
  id: string;
  userId: number;
  lastSeenAt: Date;
  expiresAt: Date;
}

/** A live session and its user, or null. Expired rows are never returned, only swept later. */
export async function findLiveSession(db: DbHandle, id: string, now: Date): Promise<{ session: SessionRow; user: User } | null> {
  const rows = await db.query<{
    id: string; user_id: number; last_seen_at: Date; expires_at: Date;
    tg_user_id: string; chat_id: string | null; role: 'admin' | 'member'; lang: 'ru' | 'en';
    deposit: string | null; risk_pct: number; daily_loss_limit_pct: number | null;
    dex_alerts: boolean; calendar_alerts: boolean; invited_by: number | null; disabled: boolean; created_at: Date;
  }>(
    `select s.id, s.user_id, s.last_seen_at, s.expires_at,
            u.tg_user_id, u.chat_id, u.role, u.lang, u.deposit, u.risk_pct,
            u.daily_loss_limit_pct, u.dex_alerts, u.calendar_alerts, u.invited_by, u.disabled, u.created_at
       from web_sessions s join users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > $2`,
    [id, now],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    session: { id: r.id, userId: r.user_id, lastSeenAt: new Date(r.last_seen_at), expiresAt: new Date(r.expires_at) },
    user: {
      id: r.user_id, tgUserId: Number(r.tg_user_id), chatId: r.chat_id === null ? null : Number(r.chat_id),
      role: r.role, lang: r.lang, deposit: r.deposit === null ? null : Number(r.deposit),
      riskPct: Number(r.risk_pct), dailyLossLimitPct: r.daily_loss_limit_pct === null ? null : Number(r.daily_loss_limit_pct),
      dexAlerts: r.dex_alerts, calendarAlerts: r.calendar_alerts, invitedBy: r.invited_by, disabled: r.disabled, createdAt: new Date(r.created_at),
    },
  };
}

/** Slides the window: only called when `shouldRefreshSession` says the row is an hour stale. */
export async function touchSession(db: DbHandle, id: string, now: Date, expiresAt: Date): Promise<void> {
  await db.query('update web_sessions set last_seen_at = $2, expires_at = $3 where id = $1', [id, now, expiresAt]);
}

export async function deleteSession(db: DbHandle, id: string): Promise<void> {
  await db.query('delete from web_sessions where id = $1', [id]);
}

/**
 * §4: "disabling a member deletes their sessions". Called wherever a member is disabled, so
 * revoking access logs the person out of the dashboard rather than leaving a 30-day cookie live.
 */
export async function deleteSessionsForUser(db: DbHandle, userId: number): Promise<number> {
  const rows = await db.query<{ id: string }>('delete from web_sessions where user_id = $1 returning id', [userId]);
  return rows.length;
}

/** Housekeeping: neither table should grow forever on a 1 GB box. */
export async function sweepExpired(db: Db, now: Date): Promise<{ sessions: number; tokens: number }> {
  const sessions = await db.query<{ id: string }>('delete from web_sessions where expires_at < $1 returning id', [now]);
  const tokens = await db.query<{ token_hash: string }>('delete from web_login_tokens where expires_at < $1 returning token_hash', [now]);
  return { sessions: sessions.length, tokens: tokens.length };
}

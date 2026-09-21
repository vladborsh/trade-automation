import { createHash, randomBytes } from 'crypto';

/**
 * architecture/backtest-app-system-design.md §7.1, D7 — the `bt_session` cookie. The cookie
 * carries a random token; the database only ever sees `sha256(token)` (`auth_sessions.id`, §3),
 * so a leaked table does not hand out live sessions. Invite tokens use the same hash
 * (`invites.token_hash`).
 *
 * Pure helpers only — no Nest, no I/O — so both the HTTP guard and the WS gateway use them.
 */
export const SESSION_COOKIE_NAME = 'bt_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** §7.1 — "refreshed on any request more than one hour after `last_seen_at`". */
export const SESSION_REFRESH_AFTER_MS = 60 * 60 * 1000;

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** True when a session last seen at `lastSeenAtMs` should have its expiry slid forward. */
export function shouldRefreshSession(lastSeenAtMs: number, nowMs: number): boolean {
  return nowMs - lastSeenAtMs > SESSION_REFRESH_AFTER_MS;
}

export interface SessionCookieOptions {
  secure: boolean;
}

/** `Set-Cookie` value: `HttpOnly; SameSite=Lax; Path=/`, `Secure` per `SESSION_COOKIE_SECURE`. */
export function serializeSessionCookie(token: string, expiresAtMs: number, opts: SessionCookieOptions): string {
  return buildCookie(token, SESSION_TTL_MS / 1000, new Date(expiresAtMs), opts);
}

export function serializeClearedSessionCookie(opts: SessionCookieOptions): string {
  return buildCookie('', 0, new Date(0), opts);
}

function buildCookie(value: string, maxAgeSec: number, expires: Date, opts: SessionCookieOptions): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    `Max-Age=${maxAgeSec}`,
    `Expires=${expires.toUTCString()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Parses a `Cookie` request header into name → value (first occurrence wins, values URI-decoded). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = pair.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** The `bt_session` token from a `Cookie` header, or null when absent/empty. */
export function readSessionToken(cookieHeader: string | undefined): string | null {
  const token = parseCookieHeader(cookieHeader)[SESSION_COOKIE_NAME];
  return token ? token : null;
}

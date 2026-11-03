import { createHash, randomBytes } from 'crypto';

/**
 * IB-029 — the `ib_session` cookie and the one-time login token
 * (architecture/insight-bot-web-dashboard.md §1 W3, §4).
 *
 * **The pattern is the backtest app's `apps/signal-server/src/auth/session-cookie.ts` (§7.1),
 * copied deliberately rather than imported**: the tables, the cookie name and the TTLs are this
 * app's own, and a shared module would couple two products that are free to diverge. Where the
 * two agree (sha256 of an opaque token, sliding refresh) they agree because the reasoning is the
 * same, not because the code is.
 *
 * Why each cookie attribute, since this is the auth surface and IB-032 puts it behind a tunnel:
 *
 * - **HttpOnly** — the dashboard never needs to read the cookie from JavaScript, and withholding
 *   it means an XSS bug in a chart page cannot walk away with the session.
 * - **SameSite=Lax** — the dashboard is its own origin and makes no cross-site POSTs, so Lax
 *   costs nothing and stops a form on another site acting as the member. Not `Strict`, because
 *   the login link is followed from Telegram: a `Strict` cookie is withheld on that first
 *   cross-site navigation and the person lands logged out.
 * - **Secure, per env** — IB-032 serves the dashboard through a Cloudflare Tunnel, i.e. HTTPS,
 *   where `Secure` must be on or the cookie can be sent in clear on any downgrade. It is a flag
 *   rather than a constant only so local `http://localhost` development works at all; the
 *   deployed default is on, and `WEB_COOKIE_SECURE` is what IB-032 sets.
 *
 *   **Measured 2026-10-07 (one observation, not yet a rule):** a `Secure` `ib_session` set over
 *   plain `http://127.0.0.1:3005` **is stored and sent back** — the user followed the bot's link
 *   and landed signed in. Browsers treat `127.0.0.1` as a trusted/secure origin, so `Secure` does
 *   not need relaxing for the W4 SSM-port-forwarding path. So `WEB_COOKIE_SECURE` stays `true`
 *   there; do not set it to `false` to "make local work". If this is ever re-tested, note that
 *   `localhost` and `127.0.0.1` are not interchangeable elsewhere in this flow — Telegram rejects
 *   `localhost` in an inline button (IB-BUG-008, `infra/insight-bot/verify-telegram-link.mjs`).
 * - **Path=/** — the SPA and `/api/web` share an origin.
 *
 * Pure: no Nest, no I/O, so the guard, the controller and the specs all use the same functions.
 */

export const SESSION_COOKIE_NAME = 'ib_session';
/** §4: sliding 30 days. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** §4: "refreshed when last_seen_at is > 1 h old" — one write per hour per active session. */
export const SESSION_REFRESH_AFTER_MS = 60 * 60 * 1000;
/** §4: the login link is short-lived on purpose; it travels through a chat message. */
export const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000;
/** 32 bytes = 256 bits, so a login link cannot be guessed inside its ten minutes. */
export const TOKEN_BYTES = 32;

export function newOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * The only form of a token that ever reaches the database. Both the login token and the session
 * cookie are stored as this: a dump of either table hands out nothing replayable.
 */
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

export function serializeSessionCookie(token: string, expiresAtMs: number, opts: SessionCookieOptions): string {
  return buildCookie(token, Math.floor(SESSION_TTL_MS / 1000), new Date(expiresAtMs), opts);
}

/** Logout: the same attributes with an empty value and a past expiry, or the browser keeps it. */
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

/** Parses a `Cookie` header into name → value (first occurrence wins, values URI-decoded). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (name.length === 0 || name in out) continue;
    try {
      out[name] = decodeURIComponent(pair.slice(eq + 1).trim());
    } catch {
      out[name] = pair.slice(eq + 1).trim(); // a malformed escape is not a reason to drop the header
    }
  }
  return out;
}

export function sessionTokenFromCookies(header: string | undefined): string | null {
  const value = parseCookieHeader(header)[SESSION_COOKIE_NAME];
  return value !== undefined && value.length > 0 ? value : null;
}

/** IB-078 P1: the one link the bot sends — set up or reset the password, never a way in. */
export function credentialsUrl(webBaseUrl: string, token: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/set-password?t=${encodeURIComponent(token)}`;
}

import { z } from 'zod';

/**
 * IB-029 — the dashboard's auth wire contracts
 * (architecture/insight-bot-web-dashboard.md §1 W3, §4).
 *
 * Under `insight/` because the insight bot's web surface is a different product from the
 * backtest app's: same repository, same patterns, separate contracts.
 */

export const WebUserSchema = z.object({
  id: z.number().int().positive(),
  tgUserId: z.number().int().positive(),
  role: z.enum(['admin', 'member']),
  lang: z.enum(['ru', 'en']),
  /**
   * IB-078 — the site login (architecture/password-login-design-2026-11-02.md P4). `null` for a
   * member who has not set credentials yet: a session opened through the old `/web` link before the
   * deploy still resolves, and its `/me` must parse.
   */
  login: z.string().nullable(),
});
export type WebUser = z.infer<typeof WebUserSchema>;

/**
 * IB-029's link exchange. **The server endpoint is gone** (IB-078, password-login design P11); these
 * two schemas stay exported only because the dashboard's current login page still compiles against
 * them. IB-079 replaces that page and deletes them.
 */
export const WebExchangeRequestSchema = z.object({
  /** The 32 random bytes from the login link, base64url. */
  token: z.string().min(1).max(256),
});
export type WebExchangeRequest = z.infer<typeof WebExchangeRequestSchema>;

export const WebExchangeResponseSchema = z.object({ user: WebUserSchema });
export type WebExchangeResponse = z.infer<typeof WebExchangeResponseSchema>;

export const WebMeResponseSchema = z.object({ user: WebUserSchema });
export type WebMeResponse = z.infer<typeof WebMeResponseSchema>;

/**
 * The exchange's failure codes (§4). They are deliberately distinguishable **to the person who
 * holds the link**: 401 for a token we have never issued, 410 for one that was really issued and
 * is now spent or stale. Unlike an invite code (IB-021), a login link is not something an
 * outsider can usefully enumerate — it is 256 bits and lives for ten minutes — so telling its
 * holder "you already used this" is help, not a leak.
 */
/**
 * IB-BUG-008 — what the login page needs before anyone is signed in: which bot to talk to.
 * Public by nature (a member has to be able to find the bot) and deliberately nothing else —
 * no token, no URL, no account detail on a screen an unauthenticated visitor can reach.
 */
export const WebAuthContextSchema = z.object({ botUsername: z.string() });
export type WebAuthContext = z.infer<typeof WebAuthContextSchema>;

/**
 * `NOT_A_MEMBER` and `TELEGRAM_LOGIN_UNAVAILABLE` belonged to IB-072's Telegram widget, which IB-078
 * deleted from the server (P11); no server route sends them any more. They stay listed until IB-079
 * removes the dashboard code that still names them.
 */
export const WEB_AUTH_ERROR_CODES = [
  'TOKEN_INVALID', 'TOKEN_USED', 'TOKEN_EXPIRED', 'UNAUTHENTICATED', 'FORBIDDEN',
  'NOT_A_MEMBER', 'TELEGRAM_LOGIN_UNAVAILABLE',
  // IB-078 (design §3)
  'INVALID_CREDENTIALS', 'TOO_MANY_ATTEMPTS', 'LOGIN_TAKEN', 'BAD_LOGIN', 'WEAK_PASSWORD',
] as const;
export type WebAuthErrorCode = (typeof WEB_AUTH_ERROR_CODES)[number];

/**
 * Everything here carries a `Web` prefix on purpose. `libs/contracts` is one flat barrel shared
 * with the backtest app, which already exports `MeResponse` and `AuthErrorCode` with different
 * shapes — an unprefixed name here silently resolves to the other product's type at every call
 * site. Found the hard way: `MeResponse` compiled against the backtest app's
 * `{ id, email, role }` until the prefix went on.
 */

// ---------------------------------------------------------------------------------------------
// IB-078 — login + password (architecture/password-login-design-2026-11-02.md §3).
//
// The RULES (P4, P6) are exported so the dashboard validates with the same numbers, but the server
// decides: it normalises the login (lower case) and checks the cross-field rule (password ≠ login)
// itself. Request schemas therefore bound only the input SIZE; a rule violation is a 422 with a
// code, not a 400 from the schema.

/** P4 — stored lower-cased; ASCII only, so look-alike Cyrillic logins cannot exist. */
export const WEB_LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
/** P6 — length is the whole rule; the upper bound stops a huge "password" becoming CPU work. */
export const WEB_PASSWORD_MIN = 10;
export const WEB_PASSWORD_MAX = 128;
/** How much of a field the server reads at all. Larger than any valid value, so a too-long one is a
 * rule error (or a plain failed login), never a parse error that hints at the rule. */
const INPUT_MAX = 1024;

export const WebLoginRequestSchema = z.object({
  login: z.string().max(INPUT_MAX),
  password: z.string().max(INPUT_MAX),
});
export type WebLoginRequest = z.infer<typeof WebLoginRequestSchema>;

export const WebLoginResponseSchema = z.object({ user: WebUserSchema });
export type WebLoginResponse = z.infer<typeof WebLoginResponseSchema>;

/** `GET /auth/credentials?t=` — whether the page asks for a login. Does NOT consume the token. */
export const WebCredentialsInfoResponseSchema = z.object({
  hasLogin: z.boolean(),
  /** Present when `hasLogin`: shown, not editable (a reset keeps the login). */
  login: z.string().optional(),
});
export type WebCredentialsInfoResponse = z.infer<typeof WebCredentialsInfoResponseSchema>;

/** `POST /auth/credentials` — `login` is required only when the account has none, ignored otherwise. */
export const WebSetCredentialsRequestSchema = z.object({
  token: z.string().min(1).max(256),
  login: z.string().max(INPUT_MAX).optional(),
  password: z.string().max(INPUT_MAX),
});
export type WebSetCredentialsRequest = z.infer<typeof WebSetCredentialsRequestSchema>;

/** `POST /auth/password` — change while signed in; ends every OTHER session (P9). */
export const WebChangePasswordRequestSchema = z.object({
  current: z.string().max(INPUT_MAX),
  next: z.string().max(INPUT_MAX),
});
export type WebChangePasswordRequest = z.infer<typeof WebChangePasswordRequestSchema>;

/** P10 — the journal's outcomes; the migration's CHECK constraint lists the same words. */
export const WEB_LOGIN_OUTCOMES = [
  'success', 'bad_credentials', 'throttled', 'password_set', 'password_reset', 'password_changed', 'logout_all',
] as const;
export type WebLoginOutcome = (typeof WEB_LOGIN_OUTCOMES)[number];

/** `GET /api/web/admin/login-events?limit=` (admin only), newest first. Never carries a password. */
export const WebLoginEventSchema = z.object({
  id: z.number().int().positive(),
  /** epoch ms */
  at: z.number().int(),
  userId: z.number().int().positive().nullable(),
  /** What was typed into the login field, truncated to 64 — may be a mistyped password, hence admin-only. */
  loginAttempted: z.string().nullable(),
  outcome: z.enum(WEB_LOGIN_OUTCOMES),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type WebLoginEvent = z.infer<typeof WebLoginEventSchema>;

export const WEB_LOGIN_EVENTS_MAX_LIMIT = 500;
export const WebLoginEventsResponseSchema = z.object({ events: z.array(WebLoginEventSchema) });
export type WebLoginEventsResponse = z.infer<typeof WebLoginEventsResponseSchema>;

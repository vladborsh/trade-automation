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
});
export type WebUser = z.infer<typeof WebUserSchema>;

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
 * IB-072 — the payload the Telegram Login Widget hands to `data-onauth`, posted as-is to
 * `POST /api/web/auth/telegram` (architecture/member-access-design-2026-10-31.md M1–M3).
 *
 * **Unknown fields are kept, not stripped** (`catchall`): Telegram signs every field it sends, so a
 * field it adds tomorrow is part of `data_check_string`, and dropping it here would turn every
 * genuine login into a hash mismatch. Their values are restricted to string | number — the only
 * shapes the widget sends; anything else cannot be put into `key=value` unambiguously.
 */
export const WebTelegramLoginRequestSchema = z
  .object({
    id: z.number().int().positive(),
    first_name: z.string().max(256),
    last_name: z.string().max(256).optional(),
    username: z.string().max(64).optional(),
    photo_url: z.string().max(2048).optional(),
    auth_date: z.number().int().positive(),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .catchall(z.union([z.string().max(2048), z.number()]));
export type WebTelegramLoginRequest = z.infer<typeof WebTelegramLoginRequestSchema>;

export const WebTelegramLoginResponseSchema = z.object({ user: WebUserSchema });
export type WebTelegramLoginResponse = z.infer<typeof WebTelegramLoginResponseSchema>;

/**
 * `NOT_A_MEMBER` (403): a correctly signed Telegram identity with no `users` row. The widget never
 * creates one (M1) — membership comes only from `/invite` + `/start` in the bot — so the page says
 * "by invitation". A *disabled* member gets `TOKEN_INVALID` instead, like the link path.
 * `TELEGRAM_LOGIN_UNAVAILABLE` (503): the server has no `TELEGRAM_BOT_TOKEN`, so it cannot verify.
 */
export const WEB_AUTH_ERROR_CODES = [
  'TOKEN_INVALID', 'TOKEN_USED', 'TOKEN_EXPIRED', 'UNAUTHENTICATED', 'FORBIDDEN',
  'NOT_A_MEMBER', 'TELEGRAM_LOGIN_UNAVAILABLE',
] as const;
export type WebAuthErrorCode = (typeof WEB_AUTH_ERROR_CODES)[number];

/**
 * Everything here carries a `Web` prefix on purpose. `libs/contracts` is one flat barrel shared
 * with the backtest app, which already exports `MeResponse` and `AuthErrorCode` with different
 * shapes — an unprefixed name here silently resolves to the other product's type at every call
 * site. Found the hard way: `MeResponse` compiled against the backtest app's
 * `{ id, email, role }` until the prefix went on.
 */

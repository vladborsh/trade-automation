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

export const WEB_AUTH_ERROR_CODES = ['TOKEN_INVALID', 'TOKEN_USED', 'TOKEN_EXPIRED', 'UNAUTHENTICATED', 'FORBIDDEN'] as const;
export type WebAuthErrorCode = (typeof WEB_AUTH_ERROR_CODES)[number];

/**
 * Everything here carries a `Web` prefix on purpose. `libs/contracts` is one flat barrel shared
 * with the backtest app, which already exports `MeResponse` and `AuthErrorCode` with different
 * shapes — an unprefixed name here silently resolves to the other product's type at every call
 * site. Found the hard way: `MeResponse` compiled against the backtest app's
 * `{ id, email, role }` until the prefix went on.
 */

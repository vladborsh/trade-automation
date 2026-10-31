import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { LOGIN_TOKEN_TTL_MS } from './session-cookie';

/**
 * IB-072 — the Telegram Login Widget check (architecture/member-access-design-2026-10-31.md M2),
 * by Telegram's documented algorithm (https://core.telegram.org/widgets/login#checking-authorization):
 *
 * - `data_check_string` = every received field **except `hash`**, sorted by key, `key=value`,
 *   joined with `\n`. Every field, including ones we do not know: Telegram may add fields, and
 *   they are signed.
 * - `secret = SHA256(bot_token)` as **raw bytes**.
 * - valid iff `hex(HMAC_SHA256(secret, data_check_string)) == hash`, compared in constant time.
 *
 * **Not the Mini-App scheme.** Telegram Web Apps sign `initData` with `HMAC_SHA256("WebAppData",
 * bot_token)` as the key; that is a different product and the likely copy-paste error here. The
 * spec builds a vector with that key and requires it to fail.
 *
 * Freshness: `auth_date` at most 10 minutes old (the same window as the link token) and at most
 * 60 s in the future (clock skew). M3: there is no replay table — the payload only travels over
 * HTTPS to our own origin inside that window. If the window is ever lengthened, revisit that.
 *
 * Pure: no Nest, no I/O, the clock is a parameter.
 */

export const TELEGRAM_LOGIN_MAX_AGE_MS = LOGIN_TOKEN_TTL_MS;
export const TELEGRAM_LOGIN_MAX_FUTURE_SKEW_MS = 60 * 1000;

export type TelegramLoginFields = Readonly<Record<string, string | number>>;

export type TelegramLoginVerdict =
  | { ok: true; tgUserId: number }
  | { ok: false; reason: 'bad_hash' | 'expired' | 'future' };

export function telegramDataCheckString(fields: TelegramLoginFields): string {
  return Object.keys(fields)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;

export function verifyTelegramLogin(fields: TelegramLoginFields, botToken: string, nowMs: number): TelegramLoginVerdict {
  const hash = fields.hash;
  if (botToken.length === 0 || typeof hash !== 'string' || !HEX_SHA256.test(hash)) return { ok: false, reason: 'bad_hash' };

  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(telegramDataCheckString(fields)).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return { ok: false, reason: 'bad_hash' };

  // only now are the fields Telegram's word rather than the caller's
  const authDateMs = Number(fields.auth_date) * 1000;
  const tgUserId = Number(fields.id);
  if (!Number.isSafeInteger(tgUserId) || tgUserId <= 0 || !Number.isFinite(authDateMs)) return { ok: false, reason: 'bad_hash' };
  if (nowMs - authDateMs > TELEGRAM_LOGIN_MAX_AGE_MS) return { ok: false, reason: 'expired' };
  if (authDateMs - nowMs > TELEGRAM_LOGIN_MAX_FUTURE_SKEW_MS) return { ok: false, reason: 'future' };
  return { ok: true, tgUserId };
}

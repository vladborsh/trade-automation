import { WEB_LOGIN_PATTERN, WEB_PASSWORD_MAX, WEB_PASSWORD_MIN } from '@trade-automation/contracts';

/**
 * IB-079 — the login and password rules as the form checks them, from the SAME numbers the server
 * uses (`@trade-automation/contracts`; the server's copy is apps/insight-bot/src/web/auth/
 * credential-rules.ts). The form only saves a round trip: the server decides, and its 422 is
 * handled as well.
 */
export type LoginProblem = 'login.bad';
export type PasswordProblem = 'password.short' | 'password.long' | 'password.sameAsLogin' | 'password.mismatch';

/** The login as the server will store it: lower-cased. */
export function normalizeLogin(raw: string): string {
  return raw.toLowerCase();
}

export function loginProblem(raw: string): LoginProblem | null {
  return WEB_LOGIN_PATTERN.test(normalizeLogin(raw)) ? null : 'login.bad';
}

/** Length counts characters (code points), as the server does — an emoji is one, not two. */
export function passwordProblem(password: string, repeat: string, login: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < WEB_PASSWORD_MIN) return 'password.short';
  if (length > WEB_PASSWORD_MAX) return 'password.long';
  if (login.length > 0 && password.toLowerCase() === login.toLowerCase()) return 'password.sameAsLogin';
  if (password !== repeat) return 'password.mismatch';
  return null;
}

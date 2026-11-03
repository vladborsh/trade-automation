import { WEB_LOGIN_PATTERN, WEB_PASSWORD_MAX, WEB_PASSWORD_MIN } from '@trade-automation/contracts';

/**
 * IB-078 P4, P6 — the login and password rules, as pure functions. The numbers live in the contracts
 * (the dashboard validates with the same ones); the server is the one that decides.
 */

/** P4: lower-cased BEFORE it is checked and before it is stored, so `Ann` and `ann` are one login. */
export function normalizeLogin(raw: string): string {
  return raw.toLowerCase();
}

/** ASCII `[a-z0-9._-]`, 3–32, starting with a letter or digit — on the NORMALISED login. */
export function isValidLogin(login: string): boolean {
  return WEB_LOGIN_PATTERN.test(login);
}

/**
 * P6: 10–128 characters and not equal to the login, nothing else. Length counts code points, so an
 * emoji is one character rather than two UTF-16 units. "Equal to the login" compares
 * case-insensitively, because the login is stored lower-cased and `Ann.Smith1` would otherwise pass
 * as a password for `ann.smith1`.
 */
export function isAcceptablePassword(password: string, login: string): boolean {
  const length = [...password].length;
  if (length < WEB_PASSWORD_MIN || length > WEB_PASSWORD_MAX) return false;
  return password.toLowerCase() !== login.toLowerCase();
}

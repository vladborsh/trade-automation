import {
  WEB_AUTH_ERROR_CODES, WEB_LOGIN_OUTCOMES, WEB_LOGIN_PATTERN, WEB_PASSWORD_MAX, WEB_PASSWORD_MIN,
  WebChangePasswordRequestSchema, WebCredentialsInfoResponseSchema, WebLoginEventSchema, WebLoginRequestSchema,
  WebMeResponseSchema, WebSetCredentialsRequestSchema, WebUserSchema,
} from '../src/insight/auth';
import { WebErrorSchema } from '../src/insight/common';

/** IB-078 — the login + password contracts (architecture/password-login-design-2026-11-02.md §3, P4, P6, P10). */
const user = { id: 1, tgUserId: 111, role: 'member' as const, lang: 'ru' as const };

describe('WebUser.login', () => {
  it('carries the login, and null for a member who has not set credentials yet', () => {
    expect(WebUserSchema.parse({ ...user, login: 'ann' }).login).toBe('ann');
    expect(WebMeResponseSchema.parse({ user: { ...user, login: null } }).user.login).toBeNull();
  });

  it('is required in the shape — a server that forgets it fails the parse', () => {
    expect(WebUserSchema.safeParse(user).success).toBe(false);
  });
});

describe('WEB_LOGIN_PATTERN (P4)', () => {
  it('accepts lower-case ASCII 3–32 starting with a letter or digit', () => {
    for (const ok of ['ann', 'a1b', '0xff', 'vlad.b', 'a_b-c', 'a'.repeat(32)]) expect(WEB_LOGIN_PATTERN.test(ok)).toBe(true);
  });

  it('rejects upper case (the server lower-cases first), Cyrillic look-alikes, bad starts and lengths', () => {
    for (const bad of ['Ann', 'аnn' /* Cyrillic а */, '.ann', '-ann', '_ann', 'ab', 'a'.repeat(33), 'a b', 'ann!', '']) {
      expect(WEB_LOGIN_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe('password bounds (P6)', () => {
  it('are 10 and 128', () => {
    expect([WEB_PASSWORD_MIN, WEB_PASSWORD_MAX]).toEqual([10, 128]);
  });
});

describe('request schemas bound size only — the rules are the server’s 422s', () => {
  it('a short or long password still PARSES (WEAK_PASSWORD is the server’s answer, not a 400)', () => {
    expect(WebSetCredentialsRequestSchema.safeParse({ token: 't', login: 'ann', password: 'x' }).success).toBe(true);
    expect(WebSetCredentialsRequestSchema.safeParse({ token: 't', password: 'x'.repeat(WEB_PASSWORD_MAX + 1) }).success).toBe(true);
    expect(WebChangePasswordRequestSchema.safeParse({ current: 'a', next: 'b' }).success).toBe(true);
    expect(WebLoginRequestSchema.safeParse({ login: 'Ann', password: 'short' }).success).toBe(true);
  });

  it('but not an unbounded one, and not a missing token', () => {
    expect(WebLoginRequestSchema.safeParse({ login: 'ann', password: 'x'.repeat(2000) }).success).toBe(false);
    expect(WebSetCredentialsRequestSchema.safeParse({ token: '', password: 'x' }).success).toBe(false);
  });
});

describe('credentials info', () => {
  it('says whether the page must ask for a login', () => {
    expect(WebCredentialsInfoResponseSchema.parse({ hasLogin: false })).toEqual({ hasLogin: false });
    expect(WebCredentialsInfoResponseSchema.parse({ hasLogin: true, login: 'ann' }).login).toBe('ann');
  });
});

describe('the login journal (P10)', () => {
  it('lists exactly the outcomes the design names', () => {
    expect([...WEB_LOGIN_OUTCOMES]).toEqual([
      'success', 'bad_credentials', 'throttled', 'password_set', 'password_reset', 'password_changed', 'logout_all',
    ]);
  });

  it('has no field a password could be carried in', () => {
    expect(Object.keys(WebLoginEventSchema.shape).sort()).toEqual(['at', 'id', 'ip', 'loginAttempted', 'outcome', 'userAgent', 'userId']);
  });
});

describe('error codes', () => {
  const NEW = ['INVALID_CREDENTIALS', 'TOO_MANY_ATTEMPTS', 'LOGIN_TAKEN', 'BAD_LOGIN', 'WEAK_PASSWORD'] as const;

  it('are auth codes', () => {
    expect(WEB_AUTH_ERROR_CODES).toEqual(expect.arrayContaining([...NEW]));
  });

  it('and parse as the dashboard parses every error body — a missing one would arrive as null there', () => {
    for (const code of NEW) expect(WebErrorSchema.safeParse({ code }).success).toBe(true);
  });
});

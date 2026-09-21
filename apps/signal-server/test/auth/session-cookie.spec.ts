import {
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_MS,
  newOpaqueToken,
  parseCookieHeader,
  readSessionToken,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  sha256Hex,
  shouldRefreshSession,
} from '../../src/auth/session-cookie';

describe('session-cookie (backtest-app-system-design.md §7.1)', () => {
  const expires = Date.UTC(2026, 9, 21, 12);

  it('serialises bt_session with HttpOnly, SameSite=Lax, Path=/ and a 30-day Max-Age', () => {
    const cookie = serializeSessionCookie('tok123', expires, { secure: false });
    expect(cookie.split('; ')).toEqual([
      'bt_session=tok123',
      'Max-Age=2592000',
      'Expires=Wed, 21 Oct 2026 12:00:00 GMT',
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ]);
    expect(SESSION_TTL_MS).toBe(30 * 24 * 3600 * 1000);
  });

  it('adds Secure only when SESSION_COOKIE_SECURE is on', () => {
    expect(serializeSessionCookie('t', expires, { secure: true })).toMatch(/; Secure$/);
    expect(serializeSessionCookie('t', expires, { secure: false })).not.toContain('Secure');
  });

  it('clears the cookie with an empty value and Max-Age=0', () => {
    const cookie = serializeClearedSessionCookie({ secure: true });
    expect(cookie).toMatch(/^bt_session=; Max-Age=0; /);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
  });

  it('parses a Cookie header, first occurrence wins, values decoded', () => {
    expect(parseCookieHeader('a=1; bt_session=abc%2Fd; a=2; junk; q="quoted"')).toEqual({
      a: '1',
      bt_session: 'abc/d',
      q: 'quoted',
    });
    expect(parseCookieHeader(undefined)).toEqual({});
  });

  it('reads the session token, null when absent or empty', () => {
    expect(readSessionToken('x=1; bt_session=tok')).toBe('tok');
    expect(readSessionToken('bt_session=')).toBeNull();
    expect(readSessionToken('other=1')).toBeNull();
    expect(readSessionToken(undefined)).toBeNull();
  });

  it('refreshes only once more than an hour has passed since last seen', () => {
    const seen = 1_000_000;
    expect(SESSION_REFRESH_AFTER_MS).toBe(3_600_000);
    expect(shouldRefreshSession(seen, seen + 3_600_000)).toBe(false);
    expect(shouldRefreshSession(seen, seen + 3_600_001)).toBe(true);
  });

  it('hashes with sha256 hex and generates distinct url-safe tokens', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const a = newOpaqueToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newOpaqueToken()).not.toBe(a);
  });
});

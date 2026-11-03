import {
  LOGIN_TOKEN_TTL_MS, credentialsUrl, newOpaqueToken, parseCookieHeader, SESSION_COOKIE_NAME,
  SESSION_REFRESH_AFTER_MS, SESSION_TTL_MS, serializeClearedSessionCookie, serializeSessionCookie,
  sessionTokenFromCookies, sha256Hex, shouldRefreshSession, TOKEN_BYTES,
} from '../../src/web/auth/session-cookie';

/**
 * IB-029 — the cookie and token rules. This is the auth surface, so the attributes are asserted
 * rather than assumed: IB-032 puts the dashboard behind a Cloudflare Tunnel, where a missing
 * `Secure` would put the session cookie on the wire in clear on any downgrade.
 */

describe('the ib_session cookie', () => {
  const opts = { secure: true };

  it('is HttpOnly, SameSite=Lax and Path=/', () => {
    const cookie = serializeSessionCookie('tok', Date.UTC(2026, 9, 28), opts);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=tok`);
    expect(cookie).toContain('HttpOnly');       // an XSS in a chart page cannot read it
    expect(cookie).toContain('SameSite=Lax');   // no cross-site POST acts as the member
    expect(cookie).toContain('Path=/');
  });

  it('carries Secure when configured, and omits it only for local http', () => {
    expect(serializeSessionCookie('t', 0, { secure: true })).toContain('; Secure');
    expect(serializeSessionCookie('t', 0, { secure: false })).not.toContain('Secure');
  });

  it('is NOT SameSite=Strict — the login link is followed from Telegram', () => {
    // Strict withholds the cookie on that first cross-site navigation and the person lands
    // logged out, which is the one flow this whole feature exists to make work
    expect(serializeSessionCookie('t', 0, opts)).not.toContain('Strict');
  });

  it('expires in 30 days', () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(serializeSessionCookie('t', 0, opts)).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
  });

  it('clearing it keeps the same attributes, with an empty value and a past expiry', () => {
    const cleared = serializeClearedSessionCookie(opts);
    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('Secure'); // attributes must match or the browser keeps the old one
  });
});

describe('tokens', () => {
  it('a login token is 32 random bytes and never repeats', () => {
    expect(TOKEN_BYTES).toBe(32);
    const tokens = new Set(Array.from({ length: 500 }, () => newOpaqueToken()));
    expect(tokens.size).toBe(500);
    expect(Buffer.from([...tokens][0], 'base64url')).toHaveLength(32);
  });

  it('only the hash is ever stored, and it is stable', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).toHaveLength(64);
    expect(sha256Hex('abc')).not.toBe('abc');
  });

  it('the login link is short-lived — it travels through a chat message', () => {
    expect(LOGIN_TOKEN_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('builds the login URL without doubling the slash', () => {
    expect(credentialsUrl('https://d.example.com', 'tok')).toBe('https://d.example.com/set-password?t=tok');
    expect(credentialsUrl('https://d.example.com/', 'tok')).toBe('https://d.example.com/set-password?t=tok');
  });

  it('URL-encodes the token so a base64url edge case cannot break the link', () => {
    expect(credentialsUrl('https://d', 'a+b/c=')).toBe('https://d/set-password?t=a%2Bb%2Fc%3D');
  });
});

describe('sliding expiry', () => {
  it('refreshes only when the session is over an hour stale — one write per hour, not per request', () => {
    const now = Date.UTC(2026, 8, 28, 12, 0, 0);
    expect(shouldRefreshSession(now - 60_000, now)).toBe(false);
    expect(shouldRefreshSession(now - SESSION_REFRESH_AFTER_MS, now)).toBe(false);
    expect(shouldRefreshSession(now - SESSION_REFRESH_AFTER_MS - 1, now)).toBe(true);
  });
});

describe('parseCookieHeader', () => {
  it('finds the session among other cookies', () => {
    expect(sessionTokenFromCookies(`a=1; ${SESSION_COOKIE_NAME}=tok; b=2`)).toBe('tok');
  });

  it('is null when absent, empty or the header is missing', () => {
    expect(sessionTokenFromCookies(undefined)).toBeNull();
    expect(sessionTokenFromCookies('a=1')).toBeNull();
    expect(sessionTokenFromCookies(`${SESSION_COOKIE_NAME}=`)).toBeNull();
  });

  it('first occurrence wins, so a second forged cookie cannot override the real one', () => {
    expect(sessionTokenFromCookies(`${SESSION_COOKIE_NAME}=real; ${SESSION_COOKIE_NAME}=forged`)).toBe('real');
  });

  it('survives a malformed percent-escape rather than dropping the whole header', () => {
    expect(parseCookieHeader('a=%E0%A4%A; b=2')).toMatchObject({ a: '%E0%A4%A', b: '2' });
  });
});

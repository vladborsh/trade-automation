import { HttpException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import * as users from '../../src/users/pg/users.repo';
import { WebAdminController } from '../../src/web/admin/login-events.controller';
import { CredentialsService } from '../../src/web/auth/credentials.service';
import { LoginGuard } from '../../src/web/auth/login-throttle';
import { PasswordHasher } from '../../src/web/auth/password';
import { sha256Hex, SESSION_COOKIE_NAME } from '../../src/web/auth/session-cookie';
import { WebAuthController } from '../../src/web/auth/web-auth.controller';
import { WebAuthService } from '../../src/web/auth/web-auth.service';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-078 — login + password against a real database (migration 021), through the real controller,
 * service, repository and hasher. What each case can disagree with is named in it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('password-login.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

/** Real scrypt at a small N, counting every verify — the dummy hash for unknown logins is full cost. */
class CountingHasher extends PasswordHasher {
  verifies = 0;
  constructor() {
    super({ N: 1024, r: 8, p: 1 });
  }
  override async verify(password: string, stored: string): Promise<boolean> {
    this.verifies++;
    return super.verify(password, stored);
  }
}

const config = (env: Record<string, unknown>) => ({ env: { get: (k: string) => env[k] } }) as never;

interface Res { setHeader: jest.Mock }
const res = (): Res => ({ setHeader: jest.fn() });
const req = (over: { cookie?: string; ip?: string; headers?: Record<string, string> } = {}) => ({
  headers: { 'user-agent': 'jest-agent', ...(over.cookie ? { cookie: over.cookie } : {}), ...over.headers },
  socket: { remoteAddress: over.ip ?? '10.9.9.9' },
}) as never;
const cookieOf = (r: Res): string => {
  const header = String(r.setHeader.mock.calls.find((c) => c[0] === 'Set-Cookie')?.[1] ?? '');
  const m = new RegExp(`^${SESSION_COOKIE_NAME}=([^;]+);`).exec(header);
  if (!m) throw new Error(`no session cookie in ${header}`);
  return m[1];
};
async function statusOf(p: Promise<unknown>): Promise<[number, unknown]> {
  try {
    await p;
    return [200, null];
  } catch (e) {
    if (e instanceof HttpException) return [e.getStatus(), e.getResponse()];
    throw e;
  }
}

maybeDescribe('IB-078 password login against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let auth: WebAuthService;
  let hasher: CountingHasher;
  let creds: CredentialsService;
  let ctrl: WebAuthController;
  let adminId: number;
  let bobId: number;
  let carolId: number;

  const linkToken = async (userId: number): Promise<string> => {
    const url = await creds.createCredentialsLink(userId);
    return new URL(url as string).searchParams.get('t') as string;
  };
  const login = async (l: string, p: string, ip = '10.9.9.9') => {
    const r = res();
    const body = await ctrl.login({ login: l, password: p }, req({ ip }), r as never);
    return { body, cookie: cookieOf(r) };
  };
  const events = async () => db.query<{ outcome: string; login_attempted: string | null; user_id: number | null; ip: string | null; user_agent: string | null }>(
    'select outcome, login_attempted, user_id, ip, user_agent from web_login_events order by id');

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_pwlogin', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    // to 020 first, so a /web login token minted "before the deploy" can be seeded and 021 seen to kill it
    await runMigrations({ connectionString: url.toString(), target: '020' });
    db = new PgDatabase(url.toString());

    const now = new Date();
    adminId = (await users.bootstrapAdmin(db, 111)).id;
    await db.query(
      `insert into web_login_tokens (token_hash, user_id, expires_at, used_at) values ($1, $3, $4, null), ($2, $3, $4, $5)`,
      [sha256Hex('pre-deploy-unused'), sha256Hex('pre-deploy-used'), adminId, new Date(now.getTime() + 600_000), now],
    );
    await runMigrations({ connectionString: url.toString() });
    for (const [code, tg] of [['aaaaaaaaaaaaaaaa', 222], ['bbbbbbbbbbbbbbbb', 333]] as const) {
      await users.createInvite(db, code, adminId, new Date(now.getTime() + 86_400_000));
      await users.consumeInvite(db, code, tg, tg * 10, now);
    }
    bobId = (await users.findByTgUserId(db, 222))!.id;
    carolId = (await users.findByTgUserId(db, 333))!.id;
  }, DB_HOOK_TIMEOUT_MS);

  beforeEach(() => {
    auth = new WebAuthService(db, config({ WEB_BASE_URL: 'http://127.0.0.1:3035', WEB_COOKIE_SECURE: false, TELEGRAM_BOT_USERNAME: 'x' }));
    hasher = new CountingHasher();
    creds = new CredentialsService(db, auth, hasher, new LoginGuard());
    ctrl = new WebAuthController(auth, creds);
  });

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('migration 021 deleted the unused pre-deploy /web token (it must not set a password) and kept the used one', async () => {
    expect(await statusOf(ctrl.credentialsInfo('pre-deploy-unused'))).toEqual([401, { code: 'TOKEN_INVALID' }]);
    expect(await statusOf(ctrl.credentialsInfo('pre-deploy-used'))).toEqual([410, { code: 'TOKEN_USED' }]);
  });

  it('a new link deletes the member\'s unused older ones: only the newest works', async () => {
    const first = await linkToken(bobId);
    const second = await linkToken(bobId);
    expect(await statusOf(ctrl.credentialsInfo(first))).toEqual([401, { code: 'TOKEN_INVALID' }]);
    expect(await ctrl.credentialsInfo(second)).toEqual({ hasLogin: false });
  });

  it('GET /credentials does NOT consume the token; POST consumes it only on success', async () => {
    const t = await linkToken(bobId);
    expect(await ctrl.credentialsInfo(t)).toEqual({ hasLogin: false });
    expect(await ctrl.credentialsInfo(t)).toEqual({ hasLogin: false }); // still there

    // rule failures do not spend it either
    expect(await statusOf(ctrl.setCredentials({ token: t, login: 'b', password: 'long enough pass' }, req()))).toEqual([422, { code: 'BAD_LOGIN' }]);
    expect(await statusOf(ctrl.setCredentials({ token: t, login: 'Bob', password: 'short' }, req()))).toEqual([422, { code: 'WEAK_PASSWORD' }]);
    expect(await statusOf(ctrl.setCredentials({ token: t, login: 'Bob', password: 'BOB' }, req()))).toEqual([422, { code: 'WEAK_PASSWORD' }]);

    await ctrl.setCredentials({ token: t, login: 'Bob', password: 'bob password one' }, req());
    expect(await statusOf(ctrl.credentialsInfo(t))).toEqual([410, { code: 'TOKEN_USED' }]);
    expect(await statusOf(ctrl.setCredentials({ token: t, login: 'bob', password: 'bob password two' }, req()))).toEqual([410, { code: 'TOKEN_USED' }]);
    // stored lower-cased
    expect((await db.query<{ login: string }>('select login from web_credentials where user_id = $1', [bobId]))[0].login).toBe('bob');
  });

  it('409 LOGIN_TAKEN leaves the link usable — the UNIQUE constraint decides, and rolls the claim back', async () => {
    const t = await linkToken(carolId);
    expect(await statusOf(ctrl.setCredentials({ token: t, login: 'BOB', password: 'carol password!' }, req()))).toEqual([409, { code: 'LOGIN_TAKEN' }]);
    const row = await db.query<{ used_at: Date | null }>('select used_at from web_login_tokens where token_hash = $1', [sha256Hex(t)]);
    expect(row[0].used_at).toBeNull();
    await ctrl.setCredentials({ token: t, login: 'carol', password: 'carol password!' }, req());
    expect(await ctrl.credentialsInfo(await linkToken(carolId))).toEqual({ hasLogin: true, login: 'carol' });
  });

  it('login works case-insensitively and /me carries the login', async () => {
    const { body, cookie } = await login('BoB', 'bob password one');
    expect(body.user).toEqual({ id: bobId, tgUserId: 222, role: 'member', lang: 'ru', login: 'bob' });
    const resolved = await auth.resolveSession(cookie);
    expect((await ctrl.me(resolved!.user)).user.login).toBe('bob');
  });

  it('an unknown login and a wrong password take the SAME path: one scrypt each, one answer', async () => {
    hasher.verifies = 0;
    const unknown = await statusOf(ctrl.login({ login: 'nobody', password: 'whatever pass' }, req(), res() as never));
    const unknownVerifies = hasher.verifies;
    hasher.verifies = 0;
    const wrong = await statusOf(ctrl.login({ login: 'bob', password: 'not the password' }, req(), res() as never));
    expect(unknown).toEqual([401, { code: 'INVALID_CREDENTIALS' }]);
    expect(wrong).toEqual(unknown);
    expect(unknownVerifies).toBe(1);
    expect(hasher.verifies).toBe(1);
  });

  it('a disabled member gets the same 401, also after one scrypt', async () => {
    await db.query('update users set disabled = true where id = $1', [carolId]);
    hasher.verifies = 0;
    expect(await statusOf(ctrl.login({ login: 'carol', password: 'carol password!' }, req(), res() as never))).toEqual([401, { code: 'INVALID_CREDENTIALS' }]);
    expect(hasher.verifies).toBe(1);
    await db.query('update users set disabled = false where id = $1', [carolId]);
  });

  it('change password ends every OTHER session and keeps this one', async () => {
    const a = await login('bob', 'bob password one');
    const b = await login('bob', 'bob password one');
    const userA = (await auth.resolveSession(a.cookie))!.user;
    await ctrl.changePassword(userA, { current: 'bob password one', next: 'bob password two' }, req({ cookie: `${SESSION_COOKIE_NAME}=${a.cookie}` }));
    expect(await auth.resolveSession(a.cookie)).not.toBeNull();
    expect(await auth.resolveSession(b.cookie)).toBeNull();
    expect(await statusOf(login('bob', 'bob password one'))).toEqual([401, { code: 'INVALID_CREDENTIALS' }]);
    await login('bob', 'bob password two');
  });

  it('change password with the wrong current one is 401 and changes nothing', async () => {
    const a = await login('bob', 'bob password two');
    const user = (await auth.resolveSession(a.cookie))!.user;
    expect(await statusOf(ctrl.changePassword(user, { current: 'nope nope nope', next: 'whatever whatever' }, req({ cookie: `${SESSION_COOKIE_NAME}=${a.cookie}` }))))
      .toEqual([401, { code: 'INVALID_CREDENTIALS' }]);
    await login('bob', 'bob password two');
  });

  it('a reset through the link ends ALL sessions, keeps the login, and opens none', async () => {
    const a = await login('bob', 'bob password two');
    const b = await login('bob', 'bob password two');
    const t = await linkToken(bobId);
    expect(await ctrl.credentialsInfo(t)).toEqual({ hasLogin: true, login: 'bob' });
    const r = res();
    await ctrl.setCredentials({ token: t, login: 'ignored-login', password: 'bob password three' }, req());
    expect(r.setHeader).not.toHaveBeenCalled();
    expect(await auth.resolveSession(a.cookie)).toBeNull();
    expect(await auth.resolveSession(b.cookie)).toBeNull();
    expect((await db.query<{ login: string }>('select login from web_credentials where user_id = $1', [bobId]))[0].login).toBe('bob');
    await login('bob', 'bob password three');
  });

  it('logout-all ends every session including this one, and clears the cookie', async () => {
    const a = await login('bob', 'bob password three');
    const b = await login('bob', 'bob password three');
    const user = (await auth.resolveSession(a.cookie))!.user;
    const r = res();
    await ctrl.logoutAll(user, req(), r as never);
    expect(await auth.resolveSession(a.cookie)).toBeNull();
    expect(await auth.resolveSession(b.cookie)).toBeNull();
    expect(String(r.setHeader.mock.calls[0][1])).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('the 11th failure for one login is 429, from different IPs, and runs NO scrypt', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await statusOf(ctrl.login({ login: 'carol', password: `wrong ${i} xxxxx` }, req({ ip: `10.0.0.${i}` }), res() as never)))[0]).toBe(401);
    }
    hasher.verifies = 0;
    expect(await statusOf(ctrl.login({ login: 'carol', password: 'carol password!' }, req({ ip: '10.0.1.1' }), res() as never)))
      .toEqual([429, { code: 'TOO_MANY_ATTEMPTS' }]);
    expect(hasher.verifies).toBe(0);
  });

  it('journal: every outcome, newest first through the admin endpoint, with IP and user agent', async () => {
    const outcomes = new Set((await events()).map((e) => e.outcome));
    expect([...outcomes].sort()).toEqual(['bad_credentials', 'logout_all', 'password_changed', 'password_reset', 'password_set', 'success', 'throttled']);
    const listed = await new WebAdminController(creds).loginEvents('3');
    expect(listed.events).toHaveLength(3);
    expect(listed.events[0].outcome).toBe('throttled');
    expect(listed.events[0].at).toBeGreaterThanOrEqual(listed.events[2].at);
    expect(listed.events[0]).toMatchObject({ ip: '10.0.1.1', userAgent: 'jest-agent', loginAttempted: 'carol' });
    expect((await new WebAdminController(creds).loginEvents('100000')).events.length).toBeLessThanOrEqual(500);
  });

  it('THE PASSWORD IS NEVER WRITTEN: not in any journal row and not in any log line, even typed into the login box', async () => {
    const SECRET = `pw-${randomUUID()}`;
    const logged: string[] = [];
    const spies = [
      ...(['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); })),
      jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { logged.push(String(chunk)); return true; }),
      jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => { logged.push(String(chunk)); return true; }),
    ];
    try {
      const fresh = new CredentialsService(db, auth, hasher, new LoginGuard());
      const c = new WebAuthController(auth, fresh);
      // into every endpoint that takes a password, in every field that takes one, and the login box
      await statusOf(c.login({ login: 'carol', password: SECRET }, req({ ip: '10.7.7.7' }), res() as never));
      await statusOf(c.login({ login: SECRET, password: SECRET }, req({ ip: '10.7.7.8' }), res() as never));
      await statusOf(c.login({ login: `x${SECRET}`, password: SECRET }, req({ ip: '10.7.7.9' }), res() as never));
      const t = await linkToken(adminId);
      await statusOf(c.setCredentials({ token: t, login: SECRET, password: SECRET }, req())); // BAD_LOGIN
      await c.setCredentials({ token: t, login: 'admin1', password: SECRET }, req());
      const a = await (async () => { const r = res(); await c.login({ login: 'admin1', password: SECRET }, req({ ip: '10.7.7.10' }), r as never); return cookieOf(r); })();
      const user = (await auth.resolveSession(a))!.user;
      await statusOf(c.changePassword(user, { current: SECRET, next: `${SECRET}-2` }, req({ cookie: `${SESSION_COOKIE_NAME}=${a}` })));
      await statusOf(c.changePassword(user, { current: SECRET, next: 'x' }, req({ cookie: `${SESSION_COOKIE_NAME}=${a}` })));
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const rows = await db.query<Record<string, unknown>>('select * from web_login_events');
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(SECRET);
    expect(logged.join('\n')).not.toContain(SECRET);
    expect(rows.length).toBeGreaterThan(0); // the journal was written: the absence above is not vacuous
  });

  it('H6: CLIENT_IP_HEADER unset ignores x-real-ip; set, the IP throttle and journal key on that header', async () => {
    // unset: a forged header changes nothing — the journal shows the socket address
    await statusOf(ctrl.login({ login: 'ghost1', password: 'whatever pass' }, req({ ip: '10.5.5.5', headers: { 'x-real-ip': '6.6.6.6' } }), res() as never));
    expect((await events()).pop()).toMatchObject({ ip: '10.5.5.5' });

    // set: 30 failures across 30 logins from one header address fill the IP key; the socket varies
    const viaCaddy = new WebAuthService(db, config({ WEB_BASE_URL: 'http://x', TELEGRAM_BOT_USERNAME: 'x', CLIENT_IP_HEADER: 'x-real-ip' }));
    const c = new WebAuthController(viaCaddy, new CredentialsService(db, viaCaddy, hasher, new LoginGuard()));
    for (let i = 0; i < 30; i++) {
      expect((await statusOf(c.login({ login: `ghost-${i}`, password: 'whatever pass' }, req({ ip: `172.16.0.${i}`, headers: { 'x-real-ip': '203.0.113.9' } }), res() as never)))[0]).toBe(401);
    }
    expect(await statusOf(c.login({ login: 'fresh-login', password: 'whatever pass' }, req({ ip: '172.16.1.1', headers: { 'x-real-ip': '203.0.113.9' } }), res() as never)))
      .toEqual([429, { code: 'TOO_MANY_ATTEMPTS' }]);
    expect((await events()).pop()).toMatchObject({ ip: '203.0.113.9', outcome: 'throttled' });
    // …and a different header address is not blocked
    expect((await statusOf(c.login({ login: 'fresh-login', password: 'whatever pass' }, req({ ip: '172.16.1.1', headers: { 'x-real-ip': '203.0.113.10' } }), res() as never)))[0]).toBe(401);
  });

  it('sweepExpired removes journal rows older than 90 days and keeps the rest', async () => {
    const { sweepExpired } = await import('../../src/web/auth/pg/auth.repo');
    await db.query(`insert into web_login_events (at, outcome) values (now() - interval '91 days', 'success'), (now() - interval '89 days', 'success')`);
    const before = Number((await db.query<{ n: string }>('select count(*)::text as n from web_login_events'))[0].n);
    const swept = await sweepExpired(db, new Date());
    expect(swept.loginEvents).toBe(1);
    expect(Number((await db.query<{ n: string }>('select count(*)::text as n from web_login_events'))[0].n)).toBe(before - 1);
  });
});

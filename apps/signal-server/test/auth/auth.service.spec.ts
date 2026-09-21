import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AuthService, INVITE_TTL_MS } from '../../src/auth/auth.service';
import { LoginThrottle } from '../../src/auth/login-throttle';
import { SESSION_TTL_MS, sha256Hex } from '../../src/auth/session-cookie';
import { FakeAuthRepositories, FakeClock, fakeConfig, fastHasher, makeAuthService } from './fake-auth';

async function errorOf(p: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await p;
  } catch (err) {
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error('expected a rejection');
}

const code = (c: string) => expect.objectContaining({ error: expect.objectContaining({ code: c }) });

describe('AuthService (backtest-app-system-design.md §7.1)', () => {
  let repos: FakeAuthRepositories;
  let clock: FakeClock;
  let service: ReturnType<typeof makeAuthService>;

  beforeEach(async () => {
    repos = new FakeAuthRepositories();
    clock = new FakeClock();
    service = makeAuthService(repos, clock);
    repos.addUser('alice@x.test', await fastHasher().hash('alice-password'));
  });

  describe('login', () => {
    it('issues a session whose DB id is sha256 of the cookie token', async () => {
      const session = await service.login('alice@x.test', 'alice-password', 'jest');
      expect(session.user).toEqual({ id: expect.any(String), email: 'alice@x.test', role: 'user' });
      expect(session.expiresAtMs).toBe(clock.ms + SESSION_TTL_MS);
      expect(repos.sessionRows.has(sha256Hex(session.token))).toBe(true);
      expect(repos.sessionRows.has(session.token)).toBe(false);
    });

    it('401 INVALID_CREDENTIALS for a wrong password or an unknown email', async () => {
      expect(await errorOf(service.login('alice@x.test', 'wrong-password', null))).toEqual({ status: 401, body: code('INVALID_CREDENTIALS') });
      expect(await errorOf(service.login('nobody@x.test', 'alice-password', null))).toEqual({ status: 401, body: code('INVALID_CREDENTIALS') });
    });

    it('403 USER_DISABLED only after the password is correct', async () => {
      const user = await repos.users.findByEmail('alice@x.test');
      user!.disabledAtMs = 1;
      expect((await errorOf(service.login('alice@x.test', 'wrong-password', null))).status).toBe(401);
      expect(await errorOf(service.login('alice@x.test', 'alice-password', null))).toEqual({ status: 403, body: code('USER_DISABLED') });
    });

    it('429 TOO_MANY_ATTEMPTS after 10 failures, even with the right password; clears after 15 min', async () => {
      for (let i = 0; i < 10; i++) await errorOf(service.login('alice@x.test', 'wrong-password', null));
      expect(await errorOf(service.login('alice@x.test', 'alice-password', null))).toEqual({ status: 429, body: code('TOO_MANY_ATTEMPTS') });
      clock.advance(15 * 60 * 1000);
      await expect(service.login('alice@x.test', 'alice-password', null)).resolves.toBeDefined();
    });
  });

  describe('login under concurrency (BUG-005)', () => {
    /** A hasher whose verify() waits until the test opens the gate, counting the calls that got there. */
    function gatedHasher() {
      const real = fastHasher();
      const waiting: (() => void)[] = [];
      let open = false;
      let calls = 0;
      return {
        hasher: {
          hash: (pw: string) => real.hash(pw),
          verify: async (pw: string, stored: string) => {
            calls++;
            if (!open) await new Promise<void>((resolve) => waiting.push(resolve));
            return real.verify(pw, stored);
          },
        },
        calls: () => calls,
        open: () => {
          open = true;
          waiting.splice(0).forEach((resolve) => resolve());
        },
      };
    }

    /**
     * Fires `n` logins for one email and holds every verify() until each request has either been
     * refused (settled) or is parked in verify(), so all of them are in flight at once.
     */
    async function burst(email: string, n: number) {
      const gate = gatedHasher();
      const svc = new AuthService(repos, gate.hasher as never, new LoginThrottle(), fakeConfig(), clock.now);
      let settled = 0;
      const pending = Array.from({ length: n }, () =>
        svc.login(email, 'wrong-password', null).then(
          () => 200,
          (e: HttpException) => e.getStatus(),
        ).finally(() => settled++),
      );
      const deadline = Date.now() + 3000;
      while (settled + gate.calls() < n && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
      const reachedVerifyWhileHeld = gate.calls();
      gate.open();
      const statuses = await Promise.all(pending);
      return { svc, reachedVerifyWhileHeld, totalVerify: gate.calls(), statuses };
    }

    it('50 parallel logins for one email: exactly 10 reach verify, 40 get 429 without it', async () => {
      const { svc, reachedVerifyWhileHeld, totalVerify, statuses } = await burst('alice@x.test', 50);
      expect(reachedVerifyWhileHeld).toBe(10);
      expect(totalVerify).toBe(10);
      expect(statuses.filter((s) => s === 401)).toHaveLength(10);
      expect(statuses.filter((s) => s === 429)).toHaveLength(40);
      // and the account is now throttled, even for the right password
      expect(await errorOf(svc.login('alice@x.test', 'alice-password', null))).toEqual({ status: 429, body: code('TOO_MANY_ATTEMPTS') });
    });

    it('an unknown email goes through exactly the same path', async () => {
      const { reachedVerifyWhileHeld, totalVerify, statuses } = await burst('nobody@x.test', 50);
      expect(reachedVerifyWhileHeld).toBe(10);
      expect(totalVerify).toBe(10);
      expect(statuses.filter((s) => s === 401)).toHaveLength(10);
      expect(statuses.filter((s) => s === 429)).toHaveLength(40);
    });

    it('a disabled account with the right password does not use up an attempt', async () => {
      (await repos.users.findByEmail('alice@x.test'))!.disabledAtMs = 1;
      for (let i = 0; i < 12; i++) {
        expect((await errorOf(service.login('alice@x.test', 'alice-password', null))).status).toBe(403);
      }
    });
  });

  describe('authenticate — sliding expiry', () => {
    it('resolves a fresh token without refreshing it', async () => {
      const { token } = await service.login('alice@x.test', 'alice-password', null);
      clock.advance(30 * 60 * 1000);
      await expect(service.authenticate(token)).resolves.toEqual({ user: expect.objectContaining({ email: 'alice@x.test' }), refreshedExpiresAtMs: null });
    });

    it('slides expiry to now + 30 days once more than an hour has passed', async () => {
      const { token } = await service.login('alice@x.test', 'alice-password', null);
      clock.advance(2 * 60 * 60 * 1000);
      const result = await service.authenticate(token);
      expect(result!.refreshedExpiresAtMs).toBe(clock.ms + SESSION_TTL_MS);
      expect(repos.sessionRows.get(sha256Hex(token))).toEqual(expect.objectContaining({ lastSeenAtMs: clock.ms, expiresAtMs: clock.ms + SESSION_TTL_MS }));
      // the next request within the hour does not refresh again
      clock.advance(60 * 1000);
      expect((await service.authenticate(token))!.refreshedExpiresAtMs).toBeNull();
    });

    it('a session used within its lifetime outlives the original 30 days', async () => {
      const { token } = await service.login('alice@x.test', 'alice-password', null);
      clock.advance(20 * 24 * 3600 * 1000);
      await service.authenticate(token);
      clock.advance(20 * 24 * 3600 * 1000); // 40 days after login
      await expect(service.authenticate(token)).resolves.not.toBeNull();
    });

    it('rejects and deletes an expired session; rejects unknown tokens and disabled users', async () => {
      const { token } = await service.login('alice@x.test', 'alice-password', null);
      await expect(service.authenticate('not-a-token')).resolves.toBeNull();
      (await repos.users.findByEmail('alice@x.test'))!.disabledAtMs = 1;
      await expect(service.authenticate(token)).resolves.toBeNull();
      (await repos.users.findByEmail('alice@x.test'))!.disabledAtMs = null;
      clock.advance(SESSION_TTL_MS);
      await expect(service.authenticate(token)).resolves.toBeNull();
      expect(repos.sessionRows.size).toBe(0);
    });

    it('logout deletes the row', async () => {
      const { token } = await service.login('alice@x.test', 'alice-password', null);
      await service.logout(token);
      await expect(service.authenticate(token)).resolves.toBeNull();
    });
  });

  describe('invites', () => {
    it('GET: info for a valid invite; 404 unknown; 410 used / expired', async () => {
      repos.addInvite('good', { expiresAtMs: clock.ms + INVITE_TTL_MS, email: 'bob@x.test' });
      repos.addInvite('used', { expiresAtMs: clock.ms + INVITE_TTL_MS, usedAtMs: clock.ms - 1 });
      repos.addInvite('old', { expiresAtMs: clock.ms - 1 });
      await expect(service.inviteInfo('good')).resolves.toEqual({ email: 'bob@x.test', expiresAt: clock.ms + INVITE_TTL_MS });
      expect(await errorOf(service.inviteInfo('nope'))).toEqual({ status: 404, body: code('INVITE_UNKNOWN') });
      expect(await errorOf(service.inviteInfo('used'))).toEqual({ status: 410, body: code('INVITE_USED') });
      expect(await errorOf(service.inviteInfo('old'))).toEqual({ status: 410, body: code('INVITE_EXPIRED') });
    });

    it('accept: creates a user, marks the invite used by them, opens a session — once', async () => {
      const invite = repos.addInvite('tok', { expiresAtMs: clock.ms + INVITE_TTL_MS });
      const session = await service.acceptInvite('tok', 'bob@x.test', 'bob-password-1', null);
      expect(session.user).toEqual(expect.objectContaining({ email: 'bob@x.test', role: 'user' }));
      expect(repos.inviteRows.get(invite.id)).toEqual(expect.objectContaining({ usedAtMs: clock.ms, usedBy: session.user.id }));
      await expect(service.login('bob@x.test', 'bob-password-1', null)).resolves.toBeDefined();
      expect(await errorOf(service.acceptInvite('tok', 'carol@x.test', 'carol-password', null))).toEqual({ status: 410, body: code('INVITE_USED') });
    });

    it('accept: 410 INVITE_EXPIRED at the 7-day boundary, 404 unknown, 409 EMAIL_TAKEN', async () => {
      repos.addInvite('late', { expiresAtMs: clock.ms + INVITE_TTL_MS });
      clock.advance(INVITE_TTL_MS);
      expect(await errorOf(service.acceptInvite('late', 'bob@x.test', 'bob-password-1', null))).toEqual({ status: 410, body: code('INVITE_EXPIRED') });
      expect(await errorOf(service.acceptInvite('nope', 'bob@x.test', 'bob-password-1', null))).toEqual({ status: 404, body: code('INVITE_UNKNOWN') });
      repos.addInvite('dup', { expiresAtMs: clock.ms + INVITE_TTL_MS });
      expect(await errorOf(service.acceptInvite('dup', 'ALICE@x.test', 'alice-password', null))).toEqual({ status: 409, body: code('EMAIL_TAKEN') });
    });
  });

  it('without a database every operation is 503 and `enabled` is false', async () => {
    const disabled = makeAuthService(null);
    expect(disabled.enabled).toBe(false);
    await expect(disabled.login('a@x.test', 'pw', null)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(disabled.authenticate('t')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(disabled.inviteInfo('t')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(disabled.acceptInvite('t', 'a@x.test', 'long-enough', null)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(() => disabled.assertEnabled()).toThrow(ServiceUnavailableException);
  });
});

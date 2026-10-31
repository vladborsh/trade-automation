import { createHash, createHmac } from 'crypto';
import { HttpException } from '@nestjs/common';
import * as authRepo from '../../src/web/auth/pg/auth.repo';
import * as usersRepo from '../../src/users/pg/users.repo';
import { WebAuthService } from '../../src/web/auth/web-auth.service';
import { WebAuthController } from '../../src/web/auth/web-auth.controller';
import { SESSION_COOKIE_NAME } from '../../src/web/auth/session-cookie';
import type { User } from '../../src/users/user.model';

jest.mock('../../src/web/auth/pg/auth.repo');
jest.mock('../../src/users/pg/users.repo');

/**
 * IB-072 / design M1 — the decision table of `POST /api/web/auth/telegram`, without a database
 * (the repos are mocked; `test/db/web-auth-telegram.integration.spec.ts` runs the same paths on
 * Postgres). What matters most: the widget NEVER creates a users row, and a disabled member looks
 * exactly like a bad signature.
 */
const TOKEN = '42:FakeSpecToken';
const NOW = new Date('2026-11-01T12:00:00Z');
const AUTH_DATE = Math.floor(NOW.getTime() / 1000) - 5;

function signedPayload(id: number, extra: Record<string, string | number> = {}): Record<string, string | number> {
  const f: Record<string, string | number> = { id, first_name: 'Ann', auth_date: AUTH_DATE, ...extra };
  const dcs = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join('\n');
  const hash = createHmac('sha256', createHash('sha256').update(TOKEN).digest()).update(dcs).digest('hex');
  return { ...f, hash };
}

const member: User = {
  id: 7, tgUserId: 777, chatId: 777, role: 'member', lang: 'en', deposit: null, riskPct: 1,
  dailyLossLimitPct: null, dexAlerts: false, calendarAlerts: true, invitedBy: 1, disabled: false, createdAt: NOW,
};

const config = (env: Record<string, unknown>) => ({ env: { get: (k: string) => env[k] } }) as never;
const fakeDb = {} as never;

const mockedAuth = jest.mocked(authRepo);
const mockedUsers = jest.mocked(usersRepo);

beforeEach(() => {
  jest.resetAllMocks();
  mockedAuth.createSession.mockResolvedValue(undefined);
  mockedAuth.findLiveSession.mockImplementation(async (_db, id) => ({
    session: { id, userId: member.id, lastSeenAt: NOW, expiresAt: NOW },
    user: member,
  }));
});

const service = (env: Record<string, unknown> = { TELEGRAM_BOT_TOKEN: TOKEN }) => new WebAuthService(fakeDb, config(env));

describe('WebAuthService.loginWithTelegram', () => {
  it('a signed payload of an existing member opens a session for THAT member', async () => {
    mockedUsers.findByTgUserId.mockResolvedValue(member);
    const out = await service().loginWithTelegram(signedPayload(777), NOW);
    expect(out).toMatchObject({ ok: true, user: { id: 7 } });
    expect(mockedUsers.findByTgUserId).toHaveBeenCalledWith(fakeDb, 777);
    expect(mockedAuth.createSession).toHaveBeenCalledWith(fakeDb, expect.any(String), 7, expect.any(Date));
  });

  it('an unknown tg_user_id is NOT_A_MEMBER 403, and NO users row is created', async () => {
    mockedUsers.findByTgUserId.mockResolvedValue(null);
    expect(await service().loginWithTelegram(signedPayload(999), NOW)).toEqual({ ok: false, code: 'NOT_A_MEMBER', status: 403 });
    // the users repo was only ever read: no insert, no invite, no bootstrap, no update
    const checked: string[] = [];
    for (const [name, fn] of Object.entries(mockedUsers)) {
      if (name === 'findByTgUserId' || typeof fn !== 'function' || !('mock' in fn)) continue;
      checked.push(name);
      expect([name, (fn as jest.Mock).mock.calls.length]).toEqual([name, 0]);
    }
    // the loop really looked at the writers, not at an empty list
    expect(checked).toEqual(expect.arrayContaining(['consumeInvite', 'bootstrapAdmin']));
    expect(mockedAuth.createSession).not.toHaveBeenCalled();
  });

  it('a disabled member is TOKEN_INVALID 401 — the same answer as a forged payload', async () => {
    mockedUsers.findByTgUserId.mockResolvedValue({ ...member, disabled: true });
    expect(await service().loginWithTelegram(signedPayload(777), NOW)).toEqual({ ok: false, code: 'TOKEN_INVALID', status: 401 });
    expect(mockedAuth.createSession).not.toHaveBeenCalled();
  });

  it('a bad signature is TOKEN_INVALID and never reaches the database', async () => {
    const p = { ...signedPayload(777), id: 778 };
    expect(await service().loginWithTelegram(p, NOW)).toEqual({ ok: false, code: 'TOKEN_INVALID', status: 401 });
    expect(mockedUsers.findByTgUserId).not.toHaveBeenCalled();
  });

  it('an expired payload is TOKEN_INVALID', async () => {
    mockedUsers.findByTgUserId.mockResolvedValue(member);
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);
    expect(await service().loginWithTelegram(signedPayload(777), later)).toEqual({ ok: false, code: 'TOKEN_INVALID', status: 401 });
  });

  it('without TELEGRAM_BOT_TOKEN it is TELEGRAM_LOGIN_UNAVAILABLE 503', async () => {
    const svc = service({});
    expect(svc.telegramLoginAvailable).toBe(false);
    expect(await svc.loginWithTelegram(signedPayload(777), NOW)).toEqual({ ok: false, code: 'TELEGRAM_LOGIN_UNAVAILABLE', status: 503 });
  });

  it('a member disabled between the lookup and the insert gets no session (openSession re-checks)', async () => {
    mockedUsers.findByTgUserId.mockResolvedValue(member);
    mockedAuth.findLiveSession.mockImplementation(async (_db, id) => ({
      session: { id, userId: 7, lastSeenAt: NOW, expiresAt: NOW }, user: { ...member, disabled: true },
    }));
    expect(await service().loginWithTelegram(signedPayload(777), NOW)).toEqual({ ok: false, code: 'TOKEN_INVALID', status: 401 });
    expect(mockedAuth.deleteSession).toHaveBeenCalled();
  });
});

describe('the link exchange still goes through the same openSession', () => {
  it('exchange of a valid token opens a session and stores only hashes', async () => {
    mockedAuth.consumeLoginToken.mockResolvedValue({ kind: 'ok', userId: 7 });
    const out = await service().exchange('tok', NOW);
    expect(out).toMatchObject({ ok: true, user: { id: 7 } });
    const [, storedId] = mockedAuth.createSession.mock.calls[0];
    expect(storedId).toMatch(/^[0-9a-f]{64}$/);
    expect(storedId).not.toBe((out as { token: string }).token);
  });

  it('exchange for a disabled member stays TOKEN_INVALID 401', async () => {
    mockedAuth.consumeLoginToken.mockResolvedValue({ kind: 'ok', userId: 7 });
    mockedAuth.findLiveSession.mockImplementation(async (_db, id) => ({
      session: { id, userId: 7, lastSeenAt: NOW, expiresAt: NOW }, user: { ...member, disabled: true },
    }));
    expect(await service().exchange('tok', NOW)).toEqual({ ok: false, code: 'TOKEN_INVALID', status: 401 });
  });
});

describe('POST /api/web/auth/telegram (controller)', () => {
  const res = () => ({ setHeader: jest.fn() });
  const statusOf = async (p: Promise<unknown>) => {
    try { await p; return 200; } catch (e) { return [(e as HttpException).getStatus(), (e as HttpException).getResponse()]; }
  };

  it('success: the ib_session cookie and the member, nothing more', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      mockedUsers.findByTgUserId.mockResolvedValue(member);
      const r = res();
      const body = await new WebAuthController(service({ TELEGRAM_BOT_TOKEN: TOKEN, WEB_COOKIE_SECURE: true }))
        .telegram(signedPayload(777, { username: 'ann', photo_url: 'https://t.me/i/a.jpg' }), r as never);
      expect(body).toEqual({ user: { id: 7, tgUserId: 777, role: 'member', lang: 'en' } });
      const cookie = r.setHeader.mock.calls[0][1] as string;
      expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=[^;]+;`));
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a body that is not a widget payload is 401 TOKEN_INVALID', async () => {
    const ctrl = new WebAuthController(service());
    expect(await statusOf(ctrl.telegram({ token: 'x' }, res() as never))).toEqual([401, { code: 'TOKEN_INVALID' }]);
    expect(await statusOf(ctrl.telegram(null, res() as never))).toEqual([401, { code: 'TOKEN_INVALID' }]);
  });

  it('NOT_A_MEMBER is 403 and sets no cookie', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      mockedUsers.findByTgUserId.mockResolvedValue(null);
      const r = res();
      expect(await statusOf(new WebAuthController(service()).telegram(signedPayload(999), r as never)))
        .toEqual([403, { code: 'NOT_A_MEMBER' }]);
      expect(r.setHeader).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('no bot token: 503 TELEGRAM_LOGIN_UNAVAILABLE, even for a malformed body', async () => {
    const ctrl = new WebAuthController(service({}));
    expect(await statusOf(ctrl.telegram({}, res() as never))).toEqual([503, { code: 'TELEGRAM_LOGIN_UNAVAILABLE' }]);
  });
});

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminOnly, Public, WebAuthGuard, WEB_API_PREFIX, type RequestWithUser } from '../../src/web/auth/web-auth.guard';
import { SESSION_COOKIE_NAME } from '../../src/web/auth/session-cookie';
import type { User } from '../../src/users/user.model';

/**
 * IB-029 — the guard on `/api/web/*`.
 *
 * It is registered app-wide (Tech Lead's ruling: module-wide, so IB-030's controllers inherit
 * it without a decorator), which makes two properties load-bearing and worth asserting rather
 * than assuming:
 *
 * 1. it protects **everything** under `/api/web`, including routes that do not exist yet;
 * 2. it leaves the unauthenticated ops surface (`/health`, `/metrics`) alone, and that surface
 *    must not grow the fields the guarded one exposes.
 */

const member: User = {
  id: 2, tgUserId: 222, chatId: 222, role: 'member', lang: 'ru', deposit: 1000, riskPct: 1,
  dailyLossLimitPct: null, dexAlerts: false, calendarAlerts: true, invitedBy: 1, disabled: false, createdAt: new Date(),
};
const admin: User = { ...member, id: 1, tgUserId: 111, role: 'admin' };

const ctx = (request: RequestWithUser, meta: Record<string, boolean> = {}) => {
  const response = { setHeader: jest.fn() };
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => meta[key as string] ?? false);
  return {
    reflector,
    response,
    context: {
      getHandler: () => () => {},
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext,
  };
};

const withCookie = (url: string, token?: string): RequestWithUser => ({
  url,
  headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
});

const auth = (over: Partial<{ resolve: unknown; secure: boolean }> = {}) => ({
  resolveSession: jest.fn(async () => (over.resolve === undefined ? { user: member } : over.resolve)),
  cookieSecure: over.secure ?? true,
}) as never;

describe('what the guard protects', () => {
  it('guards every /api/web route, including ones that do not exist yet', async () => {
    const service = auth();
    for (const url of ['/api/web/auth/me', '/api/web/health/streams', '/api/web/coverage', '/api/web/anything/at/all']) {
      const { context, reflector } = ctx(withCookie(url));
      await expect(new WebAuthGuard(service, reflector).canActivate(context)).rejects.toThrow(UnauthorizedException);
    }
  });

  it('LEAVES THE OPS SURFACE ALONE — /health and /metrics need no cookie', async () => {
    const service = auth();
    for (const url of ['/health', '/metrics', '/', '/login', '/assets/main.js']) {
      const { context, reflector } = ctx(withCookie(url));
      await expect(new WebAuthGuard(service, reflector).canActivate(context)).resolves.toBe(true);
    }
    expect((service as unknown as { resolveSession: jest.Mock }).resolveSession).not.toHaveBeenCalled();
  });

  it('the prefix is exact — /api/website is not /api/web/...', async () => {
    // a route that merely starts with the same letters must not be mistaken for the dashboard
    const { context, reflector } = ctx(withCookie('/api/webhooks/telegram'));
    await expect(new WebAuthGuard(auth(), reflector).canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(WEB_API_PREFIX).toBe('/api/web');
  });

  it('ignores the query string when matching', async () => {
    const { context, reflector } = ctx(withCookie('/health?verbose=1'));
    await expect(new WebAuthGuard(auth(), reflector).canActivate(context)).resolves.toBe(true);
  });
});

describe('authentication', () => {
  it('401 without a cookie, and the session is never looked up', async () => {
    const service = auth();
    const { context, reflector } = ctx(withCookie('/api/web/auth/me'));
    await expect(new WebAuthGuard(service, reflector).canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect((service as unknown as { resolveSession: jest.Mock }).resolveSession).not.toHaveBeenCalled();
  });

  it('401 when the cookie does not resolve — expired, revoked or forged', async () => {
    const { context, reflector } = ctx(withCookie('/api/web/auth/me', 'nope'));
    await expect(new WebAuthGuard(auth({ resolve: null }), reflector).canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches the member on success', async () => {
    const request = withCookie('/api/web/auth/me', 'good');
    const { context, reflector } = ctx(request);
    await expect(new WebAuthGuard(auth(), reflector).canActivate(context)).resolves.toBe(true);
    expect(request.ibUser).toBe(member);
  });

  it('@Public() opens a route — the exchange arrives with no cookie', async () => {
    const { context, reflector } = ctx(withCookie('/api/web/auth/exchange'), { 'ib:public': true });
    await expect(new WebAuthGuard(auth(), reflector).canActivate(context)).resolves.toBe(true);
    expect(typeof Public()).toBe('function');
  });
});

describe('the sliding window is renewed by the guard', () => {
  it('re-sends the cookie when the session was refreshed', async () => {
    const service = auth({ resolve: { user: member, refreshedExpiresAtMs: Date.UTC(2026, 10, 1) } });
    const { context, reflector, response } = ctx(withCookie('/api/web/auth/me', 'good'));
    await new WebAuthGuard(service, reflector).canActivate(context);

    expect(response.setHeader).toHaveBeenCalledTimes(1);
    const [, cookie] = response.setHeader.mock.calls[0];
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=good`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
  });

  it('sends nothing when the session was not due a refresh — one write per hour, not per request', async () => {
    const { context, reflector, response } = ctx(withCookie('/api/web/auth/me', 'good'));
    await new WebAuthGuard(auth(), reflector).canActivate(context);
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});

describe('@AdminOnly', () => {
  it('403 for a member', async () => {
    const { context, reflector } = ctx(withCookie('/api/web/admin/members', 'good'), { 'ib:adminOnly': true });
    await expect(new WebAuthGuard(auth(), reflector).canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('allows an admin', async () => {
    const { context, reflector } = ctx(withCookie('/api/web/admin/members', 'good'), { 'ib:adminOnly': true });
    await expect(new WebAuthGuard(auth({ resolve: { user: admin } }), reflector).canActivate(context)).resolves.toBe(true);
    expect(typeof AdminOnly()).toBe('function');
  });

  it('authenticates BEFORE checking the role — an anonymous caller gets 401, not 403', async () => {
    // 403 would tell a stranger the route exists and is admin-only
    const { context, reflector } = ctx(withCookie('/api/web/admin/members'), { 'ib:adminOnly': true });
    await expect(new WebAuthGuard(auth(), reflector).canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});

/**
 * The Tech Lead's ruling: the unauthenticated ops `/health` and the guarded dashboard health are
 * two different things and must stay apart. This is the guard that keeps them apart, so the
 * forbidden list lives here. **IB-030: add any detailed field that must never appear
 * unauthenticated.**
 */
describe('the ops /health must not leak the dashboard\'s detail', () => {
  const FORBIDDEN_IN_OPS_HEALTH = [
    'coverage', 'gapReports', 'gap_reports', 'partitions', 'databaseSize', 'pg_database_size',
    'users', 'members', 'invites', 'deposit', 'tgUserId', 'chatId',
  ];

  it('the ops payload carries only liveness fields', async () => {
    // the shape insight-bot's unauthenticated GET /health has served since IB-003
    const opsHealth = {
      streams: [{ id: 'binance-perp:kline_1m', venue: 'binance', lastMessageAgeSec: 1, reconnects24h: 0, gapsOpen: 0, mode: 'ws', degradedReason: null, expectedIntervalSec: null }],
      db: { lagSec: null },
      budget: { binanceWeightUsed1m: 0 },
    };
    const serialised = JSON.stringify(opsHealth);
    for (const field of FORBIDDEN_IN_OPS_HEALTH) {
      expect(serialised).not.toContain(field);
    }
  });

  it('and the detailed one is behind the guard, so it cannot be read without a cookie', async () => {
    const service = auth();
    for (const url of ['/api/web/health/streams', '/api/web/health/gap-reports', '/api/web/health/db', '/api/web/coverage']) {
      const { context, reflector } = ctx(withCookie(url));
      await expect(new WebAuthGuard(service, reflector).canActivate(context)).rejects.toThrow(UnauthorizedException);
    }
  });
});

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { WebAuthGuard, type RequestWithUser } from '../../src/web/auth/web-auth.guard';
import { SESSION_COOKIE_NAME } from '../../src/web/auth/session-cookie';
import { WebHealthController } from '../../src/web/health.controller';
import type { User } from '../../src/users/user.model';

/**
 * IB-075 (member-access design M8) — `/api/web/health/*` is admin-only, as a whole controller.
 *
 * Unlike web-auth.guard.spec.ts, nothing here is mocked between the guard and the controller: the
 * REAL Reflector reads the REAL controller's metadata, for EVERY route the controller declares
 * (found from Nest's own route metadata, so a route added later is covered without editing this
 * file). A missing or method-level-only decorator makes the member case pass, and this spec fails.
 */

const member: User = {
  id: 2, tgUserId: 222, chatId: 222, role: 'member', lang: 'ru', deposit: 1000, riskPct: 1,
  dailyLossLimitPct: null, dexAlerts: false, calendarAlerts: true, invitedBy: 1, disabled: false, createdAt: new Date(),
};
const admin: User = { ...member, id: 1, tgUserId: 111, role: 'admin' };

const base = Reflect.getMetadata(PATH_METADATA, WebHealthController) as string;
const routes = Object.getOwnPropertyNames(WebHealthController.prototype)
  .map((name) => ({ name, handler: (WebHealthController.prototype as unknown as Record<string, unknown>)[name] }))
  .filter(({ handler }) => typeof handler === 'function' && Reflect.getMetadata(METHOD_METADATA, handler) !== undefined)
  .map(({ name, handler }) => {
    const fn = handler as () => unknown;
    return { name, handler: fn, path: `/${base}/${Reflect.getMetadata(PATH_METADATA, fn) as string}` };
  });

const guardFor = (user: User | null) =>
  new WebAuthGuard(
    { resolveSession: jest.fn(async () => (user ? { user } : null)), cookieSecure: true } as never,
    new Reflector(),
  );

const contextFor = (route: (typeof routes)[number], cookie: boolean): ExecutionContext => {
  const request: RequestWithUser = { url: route.path, headers: cookie ? { cookie: `${SESSION_COOKIE_NAME}=tok` } : {} };
  return {
    getHandler: () => route.handler,
    getClass: () => WebHealthController,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader: jest.fn() }) }),
  } as unknown as ExecutionContext;
};

describe('IB-075: /api/web/health/* is admin-only', () => {
  it('finds the controller routes (an empty list would make every case below vacuous)', () => {
    expect(base).toBe('api/web/health');
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const r of routes) expect(r.path.startsWith('/api/web/health/')).toBe(true);
  });

  it('a member gets 403 FORBIDDEN on every route', async () => {
    for (const route of routes) {
      const attempt = guardFor(member).canActivate(contextFor(route, true));
      await expect(attempt).rejects.toThrow(ForbiddenException);
      await expect(attempt).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    }
  });

  it('an admin is let through on every route', async () => {
    for (const route of routes) {
      await expect(guardFor(admin).canActivate(contextFor(route, true))).resolves.toBe(true);
    }
  });

  it('no session is 401 UNAUTHENTICATED, before any role question', async () => {
    for (const route of routes) {
      await expect(guardFor(null).canActivate(contextFor(route, false))).rejects.toThrow(UnauthorizedException);
      await expect(guardFor(null).canActivate(contextFor(route, true))).rejects.toThrow(UnauthorizedException);
    }
  });
});

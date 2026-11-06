import { BadRequestException, ConflictException, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { CUSTOM_LEVELS_PER_COIN_MAX, WebChartCustomLevelsResponseSchema, WebCustomLevelsResponseSchema } from '@trade-automation/contracts';
import { CustomLevels } from '../../src/alerts/levels/custom-levels';
import { WebCustomLevelsAdminController } from '../../src/web/admin/custom-levels.controller';
import { CustomLevelsSeriesController } from '../../src/web/series/custom-levels.controller';
import { WebAuthGuard, type RequestWithUser } from '../../src/web/auth/web-auth.guard';
import { SESSION_COOKIE_NAME } from '../../src/web/auth/session-cookie';
import type { User } from '../../src/users/user.model';
import { MemoryCustomLevels } from '../alerts/levels/custom-levels.fixtures';

/**
 * IB-128 (P9) — the custom levels' web routes: admin-only as whole controllers (the REAL guard reads the REAL
 * controllers' metadata for every route Nest knows on them, as health-admin-only.spec does), and what each answers.
 */
const member: User = {
  id: 2, tgUserId: 222, chatId: 222, role: 'member', lang: 'ru', deposit: null, riskPct: 1,
  dailyLossLimitPct: null, dexAlerts: false, calendarAlerts: true, oiAlerts: false, liqAlerts: false, fundingAlerts: false, levelAlerts: false, invitedBy: 1, disabled: false, createdAt: new Date(),
};
const admin: User = { ...member, id: 1, tgUserId: 111, role: 'admin' };

const guardFor = (user: User) => new WebAuthGuard({ resolveSession: jest.fn(async () => ({ user })), cookieSecure: true } as never, new Reflector());

function routesOf(cls: { prototype: object }) {
  const base = Reflect.getMetadata(PATH_METADATA, cls) as string;
  return Object.getOwnPropertyNames(cls.prototype)
    // descriptors, not property reads: the admin controller's `levels` getter throws on a prototype with no service
    .map((name) => Object.getOwnPropertyDescriptor(cls.prototype, name)?.value as unknown)
    .filter((h): h is () => unknown => typeof h === 'function' && Reflect.getMetadata(METHOD_METADATA, h) !== undefined)
    .map((handler) => ({ handler, cls, path: `/${base}/${Reflect.getMetadata(PATH_METADATA, handler) as string}` }));
}

const ctxFor = (route: ReturnType<typeof routesOf>[number]): ExecutionContext => {
  const request: RequestWithUser = { url: route.path, headers: { cookie: `${SESSION_COOKIE_NAME}=tok` } };
  return {
    getHandler: () => route.handler,
    getClass: () => route.cls,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader: jest.fn() }) }),
  } as unknown as ExecutionContext;
};

describe('IB-128 custom level routes are admin-only', () => {
  const routes = [...routesOf(WebCustomLevelsAdminController), ...routesOf(CustomLevelsSeriesController)];

  it('finds every route (an empty list would make the next case vacuous)', () => {
    expect(routes.map((r) => r.path).sort()).toEqual([
      '/api/web/admin/alerts/levels/custom//', '/api/web/admin/alerts/levels/custom//', '/api/web/admin/alerts/levels/custom/:id',
      '/api/web/admin/alerts/levels/custom/:id', '/api/web/series/custom-levels',
    ]);
  });

  it('a member gets 403 on every route, an admin is let through', async () => {
    for (const route of routes) {
      await expect(guardFor(member).canActivate(ctxFor(route))).rejects.toThrow(ForbiddenException);
      await expect(guardFor(admin).canActivate(ctxFor(route))).resolves.toBe(true);
    }
  });
});

describe('IB-128 custom level routes', () => {
  const setup = () => {
    const store = new MemoryCustomLevels();
    const levels = new CustomLevels(store);
    return { store, admin: new WebCustomLevelsAdminController(levels), chart: new CustomLevelsSeriesController(levels) };
  };

  it('add → list; switch; delete; every answer is the active list', async () => {
    const h = setup();
    const added = WebCustomLevelsResponseSchema.parse(await h.admin.add(admin, { symbol: 'BTCUSDT', price: 72_000, note: 'range high' }));
    expect(added.levels.map((l) => [l.id, l.price, l.note, l.createdBy])).toEqual([[1, 72_000, 'range high', 1]]);
    const patched = await h.admin.patch('1', { events: { sweep_above: false } });
    expect(patched.levels[0].events).toEqual({ breakout_up: true, breakout_down: true, sweep_above: false, sweep_below: true });
    expect((await h.admin.remove(admin, '1')).levels).toEqual([]);
    expect(h.store.rows[0].deleted).toBe(true);
  });

  it('a bad body or id is 400; an unlisted coin or a missing level 404; a coin at its cap 409', async () => {
    const h = setup();
    await expect(h.admin.add(admin, { symbol: 'BTCUSDT', price: 0 })).rejects.toThrow(BadRequestException);
    await expect(h.admin.add(admin, { symbol: 'BTCUSDT', price: 1, extra: 1 })).rejects.toThrow(BadRequestException);
    await expect(h.admin.add(admin, { symbol: 'DOGEUSDT', price: 1 })).rejects.toThrow(NotFoundException);
    await expect(h.admin.patch('1', { events: { breakout_up: false } })).rejects.toThrow(NotFoundException);
    await expect(h.admin.patch('1', { events: { crossunder: false } })).rejects.toThrow(BadRequestException);
    await expect(h.admin.remove(admin, 'abc')).rejects.toThrow(BadRequestException);
    await expect(h.admin.remove(admin, '0')).rejects.toThrow(BadRequestException);
    await expect(h.admin.remove(admin, '5')).rejects.toThrow(NotFoundException);
    for (let i = 0; i < CUSTOM_LEVELS_PER_COIN_MAX; i++) await h.admin.add(admin, { symbol: 'TRXUSDT', price: 1 + i });
    await expect(h.admin.add(admin, { symbol: 'TRXUSDT', price: 99 })).rejects.toThrow(ConflictException);
  });

  it('the chart read: the coin\'s active levels only', async () => {
    const h = setup();
    await h.admin.add(admin, { symbol: 'BTCUSDT', price: 72_000 });
    await h.admin.add(admin, { symbol: 'TRXUSDT', price: 0.3 });
    await h.admin.add(admin, { symbol: 'BTCUSDT', price: 65_000, note: 'x' });
    await h.admin.remove(admin, '1');
    expect(WebChartCustomLevelsResponseSchema.parse(await h.chart.customLevels('BTCUSDT'))).toEqual({ symbol: 'BTCUSDT', levels: [{ id: 3, price: 65_000, note: 'x' }] });
    expect(() => h.chart.customLevels('btc')).toThrow(/unknown symbol/);
  });
});

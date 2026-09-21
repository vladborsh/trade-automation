import { INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthController } from '../../src/api/rest/auth.controller';
import { SessionsController } from '../../src/api/rest/backtest/sessions.controller';
import { AuthGuard } from '../../src/auth/auth.guard';
import { AuthService } from '../../src/auth/auth.service';
import { SessionService } from '../../src/backtest/session.service';
import { FakeAuthRepositories, fastHasher, makeAuthService } from '../auth/fake-auth';
import { FakeBacktestRepositories, createBody, makeSessionService } from './fake-backtest';

/** Boots real HTTP with AuthGuard as APP_GUARD, as the app does; repositories are in-memory. */
async function boot(auth: AuthService, sessions: SessionService) {
  @Module({
    controllers: [AuthController, SessionsController],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: SessionService, useValue: sessions },
      { provide: APP_GUARD, useClass: AuthGuard },
    ],
  })
  class TestModule {}
  const app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication({ logger: false });
  await app.listen(0);
  return { app, url: `${await app.getUrl()}/api/backtest/sessions` };
}

describe('/api/backtest/sessions over HTTP (backtest-app-system-design.md §7.2)', () => {
  let app: INestApplication;
  let url: string;
  let base: string;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    const authRepos = new FakeAuthRepositories();
    for (const name of ['alice', 'bob']) authRepos.addUser(`${name}@x.test`, await fastHasher().hash(`${name}-password`));
    ({ app, url } = await boot(makeAuthService(authRepos), makeSessionService(new FakeBacktestRepositories())));
    base = url.replace('/api/backtest/sessions', '');
    for (const name of ['alice', 'bob']) {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${name}@x.test`, password: `${name}-password` }),
      });
      cookies[name] = res.headers.get('set-cookie')!.split(';')[0];
    }
  });
  afterAll(() => app.close());

  const call = (who: string | null, method: string, path = '', body?: unknown) =>
    fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(who && { cookie: cookies[who] }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('401 without the cookie', async () => {
    expect((await call(null, 'GET')).status).toBe(401);
    expect((await call(null, 'POST', '', createBody())).status).toBe(401);
  });

  it('create -> list -> get -> patch timeframe -> delete, isolated between two users', async () => {
    const created = await call('alice', 'POST', '', createBody({ name: 'alice session' }));
    expect(created.status).toBe(201);
    const session = (await created.json()) as { id: string };
    expect(session).toMatchObject({ name: 'alice session', cursorMs: createBody().periodFromMs, balance: 10_000 });

    const listed = (await (await call('alice', 'GET')).json()) as { id: string }[];
    expect(listed.map((s) => s.id)).toEqual([session.id]);
    expect(await (await call('bob', 'GET')).json()).toEqual([]);

    const detail = await call('alice', 'GET', `/${session.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ session: { id: session.id }, openOrders: [], stats: { trades: 0, pnlR: 0 } });

    // bob cannot see or touch it: 404, never 403
    expect((await call('bob', 'GET', `/${session.id}`)).status).toBe(404);
    expect((await call('bob', 'PATCH', `/${session.id}`, { timeframe: '1h' })).status).toBe(404);
    expect((await call('bob', 'DELETE', `/${session.id}`)).status).toBe(404);

    const patched = await call('alice', 'PATCH', `/${session.id}`, { timeframe: '1h' });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ id: session.id, timeframe: '1h' });

    expect((await call('alice', 'DELETE', `/${session.id}`)).status).toBe(204);
    expect(await (await call('alice', 'GET')).json()).toEqual([]);
    expect((await call('alice', 'DELETE', `/${session.id}`)).status).toBe(404);
  });

  it('PATCH {layout} (T-029): 200 with the new layout; 422 LAYOUT_TOO_MANY_PANELS over the wire', async () => {
    const created = (await (await call('alice', 'POST', '', createBody({ name: 'layout edit' }))).json()) as { id: string };
    const panel = (id: string) => ({ id, kind: 'candles', instrument: 'binance:BTCUSDT' });
    const ok = await call('alice', 'PATCH', `/${created.id}`, { layout: { id: 'l', name: 'L', grid: { columns: 2, rows: 1 }, panels: [panel('a'), panel('b')] } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { layout: { panels: { id: string }[] } }).layout.panels.map((p) => p.id)).toEqual(['a', 'b']);
    const tooMany = await call('alice', 'PATCH', `/${created.id}`, {
      layout: { id: 'l', name: 'L', grid: { columns: 4, rows: 2 }, panels: ['a', 'b', 'c', 'd', 'e'].map(panel) },
    });
    expect(tooMany.status).toBe(422);
    expect(await tooMany.json()).toEqual({ error: { code: 'LAYOUT_TOO_MANY_PANELS', message: expect.any(String) } });
    expect((await call('bob', 'PATCH', `/${created.id}`, { layout: { id: 'l', name: 'L', grid: { columns: 1, rows: 1 }, panels: [panel('a')] } })).status).toBe(404);
  });

  it('422 codes travel in the {error:{code,message}} envelope; shape errors are 400', async () => {
    const res = await call('alice', 'POST', '', createBody({ periodFromMs: 0, periodToMs: 1 }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: 'PERIOD_OUTSIDE_COVERAGE', message: expect.any(String) } });
    expect((await call('alice', 'POST', '', { name: '' })).status).toBe(400);
    expect((await call('alice', 'PATCH', '/00000000-0000-4000-8000-000000000000', { timeframe: '7m' })).status).toBe(400);
  });
});

describe('/api/backtest/sessions without a database', () => {
  it('503, even though the guard lets the request through', async () => {
    const { app, url } = await boot(makeAuthService(null), makeSessionService(null));
    try {
      expect((await fetch(url)).status).toBe(503);
      expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(503);
    } finally {
      await app.close();
    }
  });
});

import { randomUUID } from 'crypto';
import { INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthController } from '../../src/api/rest/auth.controller';
import { OrdersController } from '../../src/api/rest/backtest/orders.controller';
import { SessionsController } from '../../src/api/rest/backtest/sessions.controller';
import { AuthGuard } from '../../src/auth/auth.guard';
import { AuthService } from '../../src/auth/auth.service';
import { OrderService } from '../../src/backtest/order.service';
import { SessionService } from '../../src/backtest/session.service';
import { FakeAuthRepositories, fastHasher, makeAuthService } from '../auth/fake-auth';
import { DAY, FakeBacktestRepositories, T0, candleStore, createBody, m1, makeSessionService, fakeInstrumentConfig } from './fake-backtest';

const MIN = 60_000;

/** Response bodies are untyped JSON here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
const C = T0 + 5 * DAY; // createBody's periodFromMs

/** Real HTTP with AuthGuard as APP_GUARD; repositories and the candle store are in-memory. */
async function boot(auth: AuthService, sessions: SessionService, orders: OrderService) {
  @Module({
    controllers: [AuthController, SessionsController, OrdersController],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: SessionService, useValue: sessions },
      { provide: OrderService, useValue: orders },
      { provide: APP_GUARD, useClass: AuthGuard },
    ],
  })
  class TestModule {}
  const app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication({ logger: false });
  await app.listen(0);
  return { app, base: await app.getUrl() };
}

describe('/api/backtest/sessions/:id/orders over HTTP (design §7.2)', () => {
  let app: INestApplication;
  let base: string;
  let sessionId: string;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    const authRepos = new FakeAuthRepositories();
    for (const name of ['alice', 'bob']) authRepos.addUser(`${name}@x.test`, await fastHasher().hash(`${name}-password`));
    const repos = new FakeBacktestRepositories();
    const store = candleStore([m1('binance:BTCUSDT', C - MIN, 100, 100.5, 99.5, 100)]);
    ({ app, base } = await boot(makeAuthService(authRepos), makeSessionService(repos), new OrderService(repos, store, fakeInstrumentConfig())));
    for (const name of ['alice', 'bob']) {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${name}@x.test`, password: `${name}-password` }),
      });
      cookies[name] = res.headers.get('set-cookie')!.split(';')[0];
    }
    sessionId = (await json(call('alice', 'POST', '/api/backtest/sessions', createBody()))).id;
  });
  afterAll(() => app.close());

  function call(who: string | null, method: string, path: string, body?: unknown) {
    return fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(who && { cookie: cookies[who] }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const orders = (suffix = '') => `/api/backtest/sessions/${sessionId}/orders${suffix}`;
  const market = () => ({ opId: randomUUID(), cursorMs: C, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1 });

  it('401 without the cookie', async () => {
    expect((await call(null, 'GET', orders())).status).toBe(401);
    expect((await call(null, 'POST', orders(), market())).status).toBe(401);
  });

  it('POST places (201) and a replayed opId answers 201 with the same body', async () => {
    const req = market();
    const first = await call('alice', 'POST', orders(), req);
    const second = await call('alice', 'POST', orders(), req);
    expect([first.status, second.status]).toEqual([201, 201]);
    const body = await json(first);
    expect(await json(second)).toEqual(body);
    expect(body.order).toMatchObject({ status: 'open', entryPrice: 100.25 });
  });

  it('refusals use the error envelope; a malformed body is 400', async () => {
    const res = await call('alice', 'POST', orders(), { ...market(), sl: 101 });
    expect(res.status).toBe(422);
    expect(await json(res)).toEqual({ error: { code: 'SL_ON_WRONG_SIDE', message: expect.any(String) } });
    expect((await call('alice', 'POST', orders(), { ...market(), cursorMs: C + MIN })).status).toBe(409);
    expect((await call('alice', 'POST', orders(), { ...market(), type: 'limit' })).status).toBe(400); // no limitPrice
  });

  it('cancel and close answer 200; list, get and the session detail read them back', async () => {
    const limit = (await json(call('alice', 'POST', orders(), { ...market(), type: 'limit', limitPrice: 99.5 }))).order;
    const long = (await json(call('alice', 'POST', orders(), market()))).order;

    const cancel = await call('alice', 'POST', orders(`/${limit.id}/cancel`), { opId: randomUUID(), cursorMs: C });
    expect(cancel.status).toBe(200);
    expect((await json(cancel)).status).toBe('cancelled');
    const close = await call('alice', 'POST', orders(`/${long.id}/close`), { opId: randomUUID(), cursorMs: C });
    expect(close.status).toBe(200);
    expect(await json(close)).toMatchObject({ order: { status: 'closed', closeReason: 'manual' }, balance: expect.any(Number) });

    const journal = await json(call('alice', 'GET', orders()));
    expect(journal.map((o: { seq: number }) => o.seq)).toEqual([...journal.map((o: { seq: number }) => o.seq)].sort((a, b) => a - b));
    expect((await json(call('alice', 'GET', orders('?status=cancelled')))).map((o: { id: string }) => o.id)).toEqual([limit.id]);
    expect(await json(call('alice', 'GET', orders(`/${long.id}`)))).toMatchObject({ order: { id: long.id }, modifications: [], screenshots: {} });
    const detail = await json(call('alice', 'GET', `/api/backtest/sessions/${sessionId}`));
    expect(detail.openOrders.every((o: { status: string }) => o.status === 'open' || o.status === 'pending')).toBe(true);
  });

  it('T-033: PATCH moves the stop (200), refusals use the envelope, the detail lists the modification', async () => {
    const long = (await json(call('alice', 'POST', orders(), market()))).order; // lastClose 100
    expect((await call(null, 'PATCH', orders(`/${long.id}`), { opId: randomUUID(), cursorMs: C, sl: 98 })).status).toBe(401);

    const moved = await call('alice', 'PATCH', orders(`/${long.id}`), { opId: randomUUID(), cursorMs: C, sl: 98 });
    expect(moved.status).toBe(200);
    expect(await json(moved)).toMatchObject({ id: long.id, slCurrent: 98, slInitial: 99 });

    const through = await call('alice', 'PATCH', orders(`/${long.id}`), { opId: randomUUID(), cursorMs: C, sl: 100.5 });
    expect(through.status).toBe(422);
    expect(await json(through)).toEqual({ error: { code: 'SL_ON_WRONG_SIDE', message: expect.any(String) } });
    expect((await call('alice', 'PATCH', orders(`/${long.id}`), { opId: 'nope', cursorMs: C, sl: 98 })).status).toBe(400);
    expect((await call('bob', 'PATCH', orders(`/${long.id}`), { opId: randomUUID(), cursorMs: C, sl: 98 })).status).toBe(404);

    const detail = await json(call('alice', 'GET', orders(`/${long.id}`)));
    expect(detail.modifications).toEqual([expect.objectContaining({ field: 'sl', oldValue: 99, newValue: 98, cursorMs: C })]);
  });

  it("another user's session and orders are 404", async () => {
    expect((await call('bob', 'GET', orders())).status).toBe(404);
    expect((await call('bob', 'POST', orders(), market())).status).toBe(404);
  });
});

import { randomUUID } from 'crypto';
import { INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthController } from '../../src/api/rest/auth.controller';
import { AdvanceController } from '../../src/api/rest/backtest/advance.controller';
import { SessionsController } from '../../src/api/rest/backtest/sessions.controller';
import { AuthGuard } from '../../src/auth/auth.guard';
import { AuthService } from '../../src/auth/auth.service';
import { AdvanceService } from '../../src/backtest/advance.service';
import { SessionService } from '../../src/backtest/session.service';
import { FakeAuthRepositories, fastHasher, makeAuthService } from '../auth/fake-auth';
import { DAY, FakeBacktestRepositories, T0, candleStore, createBody, m1, makeSessionService } from './fake-backtest';

const MIN = 60_000;
const C = T0 + 5 * DAY;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

describe('POST /api/backtest/sessions/:id/advance over HTTP (design §7.2)', () => {
  let app: INestApplication;
  let base: string;
  let sessionId: string;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    const authRepos = new FakeAuthRepositories();
    for (const name of ['alice', 'bob']) authRepos.addUser(`${name}@x.test`, await fastHasher().hash(`${name}-password`));
    const repos = new FakeBacktestRepositories();
    const store = candleStore([m1('binance:BTCUSDT', C - MIN, 100, 100.5, 99.5, 100)]);
    @Module({
      controllers: [AuthController, SessionsController, AdvanceController],
      providers: [
        { provide: AuthService, useValue: makeAuthService(authRepos) },
        { provide: SessionService, useValue: makeSessionService(repos) },
        { provide: AdvanceService, useValue: new AdvanceService(repos, store) },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    })
    class TestModule {}
    app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication({ logger: false });
    await app.listen(0);
    base = await app.getUrl();
    for (const name of ['alice', 'bob']) {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${name}@x.test`, password: `${name}-password` }),
      });
      cookies[name] = res.headers.get('set-cookie')!.split(';')[0];
    }
    sessionId = (await json(call('alice', `/api/backtest/sessions`, createBody()))).id;
  });
  afterAll(() => app.close());

  function call(who: string | null, p: string, body: unknown) {
    return fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(who && { cookie: cookies[who] }) },
      body: JSON.stringify(body),
    });
  }
  const advance = (who: string | null, body: unknown) => call(who, `/api/backtest/sessions/${sessionId}/advance`, body);

  it('401 without the cookie, 404 for another user, 400 for a malformed body', async () => {
    expect((await advance(null, { opId: randomUUID(), toCursorMs: C + 15 * MIN })).status).toBe(401);
    expect((await advance('bob', { opId: randomUUID(), toCursorMs: C + 15 * MIN })).status).toBe(404);
    expect((await advance('alice', { toCursorMs: C + 15 * MIN })).status).toBe(400);
  });

  it('200 with the AdvanceResult; a replayed opId answers 200 with the same body; backwards is 409 in the envelope', async () => {
    const req = { opId: randomUUID(), toCursorMs: C + 15 * MIN };
    const first = await advance('alice', req);
    const second = await advance('alice', req);
    expect([first.status, second.status]).toEqual([200, 200]);
    const body = await json(first);
    expect(body).toMatchObject({ cursorMs: C + 15 * MIN, status: 'active', balance: 10_000, events: [], orders: [] });
    expect(await json(second)).toEqual(body);

    const back = await advance('alice', { opId: randomUUID(), toCursorMs: C });
    expect(back.status).toBe(409);
    expect(await json(back)).toEqual({ error: { code: 'CURSOR_BACKWARDS', message: expect.any(String) } });
  });
});

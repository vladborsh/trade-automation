import { INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthController } from '../../src/api/rest/auth.controller';
import { SessionsController } from '../../src/api/rest/backtest/sessions.controller';
import { StatsController } from '../../src/api/rest/backtest/stats.controller';
import { AuthGuard } from '../../src/auth/auth.guard';
import { AuthService } from '../../src/auth/auth.service';
import { SessionService } from '../../src/backtest/session.service';
import { StatsService } from '../../src/backtest/stats.service';
import { FakeAuthRepositories, fastHasher, makeAuthService } from '../auth/fake-auth';
import { FakeBacktestRepositories, createBody, makeSessionService } from './fake-backtest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

describe('GET /api/backtest/sessions/:id/stats over HTTP (design §7.2)', () => {
  let app: INestApplication;
  let base: string;
  let sessionId: string;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    const authRepos = new FakeAuthRepositories();
    for (const name of ['alice', 'bob']) authRepos.addUser(`${name}@x.test`, await fastHasher().hash(`${name}-password`));
    const repos = new FakeBacktestRepositories();
    const sessions = makeSessionService(repos);
    @Module({
      controllers: [AuthController, SessionsController, StatsController],
      providers: [
        { provide: AuthService, useValue: makeAuthService(authRepos) },
        { provide: SessionService, useValue: sessions },
        { provide: StatsService, useValue: new StatsService(repos, sessions) },
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
    sessionId = (
      await json(
        fetch(`${base}/api/backtest/sessions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: cookies.alice },
          body: JSON.stringify(createBody()),
        }),
      )
    ).id;
  });
  afterAll(() => app.close());

  const get = (who: string | null, id = sessionId) =>
    fetch(`${base}/api/backtest/sessions/${id}/stats`, { headers: who ? { cookie: cookies[who] } : {} });

  it('401 without the cookie; 404 for another user or an unknown id', async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get('bob')).status).toBe(404);
    expect((await get('alice', 'not-a-uuid')).status).toBe(404);
  });

  it('200 with {computed, stored, drift}', async () => {
    const res = await get('alice');
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ computed: { trades: 0 }, stored: { tradesCount: 0, pnlCcy: 0 }, drift: false });
  });
});

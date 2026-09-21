import { INestApplication, Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthController } from '../../src/api/rest/auth.controller';
import { BacktestCandlesController } from '../../src/api/rest/backtest/candles.controller';
import { AuthGuard } from '../../src/auth/auth.guard';
import { AuthService } from '../../src/auth/auth.service';
import { ReplayAheadService } from '../../src/backtest/replay-ahead.service';
import { ReplayHistoryService } from '../../src/backtest/replay-history.service';
import { SessionService } from '../../src/backtest/session.service';
import { FakeAuthRepositories, fastHasher, makeAuthService } from '../auth/fake-auth';
import { FakeBacktestRepositories, fakeInstrumentConfig, FakeScreenshotStore } from './fake-backtest';
import { DAY, H, MIN, oneMinuteRange, tempStore } from './replay-fixtures';

const T0 = Date.UTC(2021, 5, 1);

/** Real HTTP: AuthGuard as APP_GUARD, real replay services over a temp FileCandleStore. */
describe('/api/backtest/sessions/:id/candles over HTTP (backtest-app-system-design.md §7.2)', () => {
  let app: INestApplication;
  let base: string;
  let cleanup: () => void;
  let repos: FakeBacktestRepositories;
  let sessionId: string;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const temp = tempStore();
    cleanup = temp.cleanup;
    await temp.store.upsert(oneMinuteRange(T0, T0 + 2 * DAY));

    const authRepos = new FakeAuthRepositories();
    for (const name of ['alice', 'bob']) authRepos.addUser(`${name}@x.test`, await fastHasher().hash(`${name}-password`));
    repos = new FakeBacktestRepositories();
    const sessions = new SessionService(repos, fakeInstrumentConfig(), temp.store, new FakeScreenshotStore());

    @Module({
      controllers: [AuthController, BacktestCandlesController],
      providers: [
        { provide: AuthService, useValue: makeAuthService(authRepos) },
        { provide: SessionService, useValue: sessions },
        { provide: ReplayHistoryService, useValue: new ReplayHistoryService(temp.store) },
        { provide: ReplayAheadService, useValue: new ReplayAheadService(temp.store) },
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

    const alice = [...authRepos.userRows.values()].find((u) => u.email === 'alice@x.test')!.id;
    const created = await sessions.create(alice, {
      name: 'replay',
      layout: { id: 'l', name: 'L', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT' }] },
      timeframe: '1h',
      periodFromMs: T0 + 6 * H,
      periodToMs: T0 + DAY,
      initialBalance: 1000,
      defaultRiskPct: 1,
      costs: { enabled: false, commissionPct: 0, spread: 0 },
    });
    sessionId = created.id;
    repos.rows.get(sessionId)!.session.cursorMs = T0 + 10 * H + 30 * MIN; // mid-bar
  });
  afterAll(async () => {
    await app.close();
    cleanup();
    jest.restoreAllMocks();
  });

  const get = (who: string | null, path: string) =>
    fetch(`${base}/api/backtest/sessions/${sessionId}/candles${path}`, { headers: who ? { cookie: cookies[who] } : {} });

  it('history at the cursor: closed bars plus the forming bar', async () => {
    const res = await get('alice', `?panelId=btc&timeframe=1h&before=${T0 + 10 * H + 30 * MIN}&limit=3`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bars: { openTime: number }[]; forming: { openTime: number; closed: boolean } };
    expect(body.bars.map((b) => (b.openTime - T0) / H)).toEqual([7, 8, 9]);
    expect(body.forming).toMatchObject({ openTime: T0 + 10 * H, closed: false });
  });

  it('422 FUTURE_REQUESTED when before is past the cursor, in the envelope', async () => {
    const res = await get('alice', `?panelId=btc&timeframe=1h&before=${T0 + 10 * H + 31 * MIN}`);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: 'FUTURE_REQUESTED', message: expect.any(String) } });
  });

  it('ahead is not bounded by the cursor, and is clamped to the period', async () => {
    const res = await get('alice', `/ahead?panelId=btc&fromMs=${T0 + 23 * H + 58 * MIN}&limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candles: number[][]; endOfTape: boolean };
    expect(body.candles.map((t) => (t[0] - T0) / MIN)).toEqual([23 * 60 + 58, 23 * 60 + 59]); // periodTo = T0 + 1 day
    expect(body.endOfTape).toBe(true);
  });

  it('400 for an unknown panelId or a malformed query; 404 for another user; 401 without a cookie', async () => {
    expect((await get('alice', `?panelId=eth&timeframe=1h&before=${T0}`)).status).toBe(400);
    expect((await get('alice', `/ahead?panelId=eth&fromMs=${T0}`)).status).toBe(400);
    expect((await get('alice', `?panelId=btc&timeframe=7m&before=${T0}`)).status).toBe(400);
    expect((await get('alice', `/ahead?panelId=btc&fromMs=${T0}&limit=5001`)).status).toBe(400);
    expect((await get('bob', `?panelId=btc&timeframe=1h&before=${T0}`)).status).toBe(404);
    expect((await get('bob', `/ahead?panelId=btc&fromMs=${T0}`)).status).toBe(404);
    expect((await get(null, `/ahead?panelId=btc&fromMs=${T0}`)).status).toBe(401);
  });
});

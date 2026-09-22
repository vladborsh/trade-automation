import { INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthController } from '../../src/api/rest/auth.controller';
import { ScreenshotsController } from '../../src/api/rest/backtest/screenshots.controller';
import { AuthGuard } from '../../src/auth/auth.guard';
import { AuthService } from '../../src/auth/auth.service';
import { ScreenshotService } from '../../src/backtest/screenshot.service';
import { FakeAuthRepositories, fastHasher, makeAuthService } from '../auth/fake-auth';
import { DAY, FakeBacktestRepositories, FakeScreenshotStore, T0, createBody, makeSessionService } from './fake-backtest';
import { makePng } from './png-fixture';
import { expectSameBytes } from '../bytes';

/** Real HTTP through AuthGuard: the raw image/png body reaches the handler unparsed. */
describe('PUT/GET …/orders/:orderId/screenshots/:kind over HTTP (design §7.2)', () => {
  let app: INestApplication;
  let base: string;
  let path: string;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    const authRepos = new FakeAuthRepositories();
    for (const name of ['alice', 'bob']) authRepos.addUser(`${name}@x.test`, await fastHasher().hash(`${name}-password`));
    const alice = [...authRepos.userRows.values()].find((u) => u.email === 'alice@x.test')!.id;
    const repos = new FakeBacktestRepositories();
    const session = await makeSessionService(repos).create(alice, createBody());
    const order = await repos.orders.insert({
      sessionId: session.id, seq: 1, panelId: 'btc', instrument: 'binance:BTCUSDT', side: 'long', type: 'market', status: 'open',
      placedAtMs: T0 + 5 * DAY, limitPrice: null, entryPrice: 100, entryTimeMs: T0 + 5 * DAY - 60_000, qty: 1, contractMultiplier: 1, riskPct: 1,
      riskAmountCcy: 100, sl: 90, tp: null, fillResolution: '1m',
    });
    const config = { env: { get: (k: string) => (k === 'SCREENSHOT_MAX_WIDTH_PX' ? 1280 : undefined) } } as never;

    @Module({
      controllers: [AuthController, ScreenshotsController],
      providers: [
        { provide: AuthService, useValue: makeAuthService(authRepos) },
        { provide: ScreenshotService, useValue: new ScreenshotService(repos, new FakeScreenshotStore(), config) },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    })
    class TestModule {}
    app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication({ logger: false });
    await app.listen(0);
    base = await app.getUrl();
    path = `/api/backtest/sessions/${session.id}/orders/${order.id}/screenshots`;
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

  const put = (who: string | null, kind: string, body: Buffer, contentType = 'image/png') =>
    fetch(`${base}${path}/${kind}`, { method: 'PUT', headers: { 'content-type': contentType, ...(who && { cookie: cookies[who] }) }, body });
  const get = (who: string | null, kind: string) => fetch(`${base}${path}/${kind}`, { headers: who ? { cookie: cookies[who] } : {} });

  it('PUT 201 with the dimensions, GET streams the same bytes with a private long-lived cache; a second PUT is 409', async () => {
    const png = makePng(320, 180, 7);
    const res = await put('alice', 'entry', png);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ key: expect.stringMatching(/^backtest\/screenshots\/user=.*\/entry\.png$/), width: 320, height: 180, bytes: png.length });

    const back = await get('alice', 'entry');
    expect(back.status).toBe(200);
    expect(back.headers.get('content-type')).toBe('image/png');
    expect(back.headers.get('cache-control')).toBe('private, max-age=31536000');
    expectSameBytes(Buffer.from(await back.arrayBuffer()), png);

    const again = await put('alice', 'entry', makePng(320, 180, 8));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: 'SCREENSHOT_EXISTS', message: expect.any(String) } });
  });

  it('415 for another media type, 413 over 2 MB, 400 for a non-PNG body or a bad kind', async () => {
    expect((await put('alice', 'exit', makePng(4, 4), 'application/octet-stream')).status).toBe(415);
    expect((await put('alice', 'exit', Buffer.alloc(2 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await put('alice', 'exit', Buffer.from('definitely not a png file'))).status).toBe(400);
    expect((await put('alice', 'side', makePng(4, 4))).status).toBe(400);
  });

  it('another user gets 404 for both PUT and GET; no cookie is 401', async () => {
    expect((await get('bob', 'entry')).status).toBe(404);
    expect((await put('bob', 'exit', makePng(4, 4))).status).toBe(404);
    expect((await get(null, 'entry')).status).toBe(401);
    expect((await put(null, 'exit', makePng(4, 4))).status).toBe(401);
  });
});

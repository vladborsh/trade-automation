import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { CanActivate, ExecutionContext, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Candle } from '@trade-automation/contracts';
import { OrdersController } from '../../src/api/rest/backtest/orders.controller';
import { SessionsController } from '../../src/api/rest/backtest/sessions.controller';
import { OrderService } from '../../src/backtest/order.service';
import { PgBacktestRepositories } from '../../src/backtest/pg/pg-backtest-repositories';
import { SessionService } from '../../src/backtest/session.service';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { fakeInstrumentConfig, FakeScreenshotStore } from './fake-backtest';

/**
 * BUG-002 / BUG-003 reproductions, exactly as the bug lines state them, over HTTP against a real
 * Postgres (the real repositories; a stub guard stands in for the cookie so the test needs no auth
 * tables beyond one user row). Before the fix each answered 500 (pg 22003) or stored riskPct 0;
 * now each is a 400 from the schema and writes nothing, and a refused order does not burn its opId.
 * Skipped without DATABASE_URL:  DATABASE_URL=postgres://backtest@localhost:5432/backtest_dev2 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('bounds.integration.spec.ts: DATABASE_URL not set — skipping the BUG-002/003 reproductions.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;
const FROM = Date.UTC(2024, 2, 4);
const TO = Date.UTC(2024, 2, 6);
const CURSOR = Date.UTC(2024, 2, 4, 11); // the BUG-003 cursor, 2024-03-04 11:00

maybeDescribe('BUG-002 / BUG-003 reproductions against a real Postgres', () => {
  const run = randomUUID().slice(0, 8);
  let root: string;
  let db: PgDatabase;
  let app: INestApplication;
  let base: string;
  let userId: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-it-'));
    const store = new FileCandleStore(root);
    const bars: Candle[] = [];
    for (let t = FROM - 60 * MIN; t < TO; t += MIN) {
      bars.push({ instrument: 'binance:BTCUSDT', timeframe: '1m', openTime: t, open: 62_000, high: 62_010, low: 61_990, close: 62_000, volume: 1, closed: true, source: 'venue-rest' });
    }
    await store.upsert(bars);
    await runMigrations({ connectionString: DATABASE_URL as string });
    db = new PgDatabase(DATABASE_URL as string);
    const repos = new PgBacktestRepositories(db);
    userId = (
      await db.query<{ id: string }>(`insert into users (email, password_hash, role) values ($1, 'x', 'user') returning id`, [
        `tester-${run}@bounds-it.test`,
      ])
    )[0].id;
    const user = { id: userId, email: `tester-${run}@bounds-it.test`, role: 'user' };

    class StubGuard implements CanActivate {
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = user;
        return true;
      }
    }
    @Module({
      controllers: [SessionsController, OrdersController],
      providers: [
        { provide: SessionService, useValue: new SessionService(repos, fakeInstrumentConfig(), store as never, new FakeScreenshotStore()) },
        { provide: OrderService, useValue: new OrderService(repos, store) },
        { provide: APP_GUARD, useClass: StubGuard },
      ],
    })
    class TestModule {}
    app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication({ logger: false });
    await app.listen(0);
    base = `${await app.getUrl()}/api/backtest/sessions`;
  });

  afterAll(async () => {
    await app.close();
    await db.query(`delete from users where email like $1`, [`%-${run}@bounds-it.test`]);
    await db.end();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const post = (url: string, body: unknown) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const sessionBody = (over: Record<string, unknown> = {}) => ({
    name: 'bounds',
    layout: { id: 'l', name: 'L', grid: { columns: 1, rows: 1 }, panels: [{ id: 'p1', kind: 'candles', instrument: 'binance:BTCUSDT' }] },
    timeframe: '1m',
    periodFromMs: FROM,
    periodToMs: TO,
    initialBalance: 10_000,
    defaultRiskPct: 1,
    costs: { enabled: true, commissionPct: 0.04, spread: 1 },
    ...over,
  });
  const sessionCount = async () =>
    Number((await db.query<{ n: string }>(`select count(*) as n from backtest_sessions where user_id = $1`, [userId]))[0].n);

  it('BUG-002: each out-of-range session field is a 400 and no row is written', async () => {
    const before = await sessionCount();
    for (const over of [
      { defaultRiskPct: 10_000 },
      { initialBalance: 1e13 },
      { costs: { enabled: true, commissionPct: 100_000, spread: 0 } },
      { costs: { enabled: true, commissionPct: 0, spread: 1e13 } },
      { notionalWarnMultiple: 1_000_000 },
    ]) {
      const res = await post(base, sessionBody(over));
      expect({ over, status: res.status }).toEqual({ over, status: 400 });
    }
    expect(await sessionCount()).toBe(before);
    // the report's accepted values stay accepted
    expect((await post(base, sessionBody({ defaultRiskPct: 100 }))).status).toBe(201);
    expect((await post(base, sessionBody({ initialBalance: 1e-9 }))).status).toBe(201);
  });

  it('BUG-003: riskPct 10000, 1000000 and 0.00001 are 400, no order row, and the opId is not burnt', async () => {
    const session = (await (await post(base, sessionBody())).json()) as { id: string };
    await db.query(`update backtest_sessions set cursor_ms = $2 where id = $1`, [session.id, CURSOR]);
    const L = 62_000; // lastClose at the cursor
    const orders = `${base}/${session.id}/orders`;
    const opId = randomUUID();
    const orderBody = (riskPct: number) => ({ opId, cursorMs: CURSOR, panelId: 'p1', side: 'long', type: 'market', sl: L - 500, riskPct });

    for (const riskPct of [10_000, 1_000_000, 0.00001]) {
      const res = await post(orders, orderBody(riskPct));
      expect({ riskPct, status: res.status }).toEqual({ riskPct, status: 400 });
    }
    const rows = async () => (await db.query(`select id from orders where session_id = $1`, [session.id])).length;
    expect(await rows()).toBe(0);
    expect((await db.query(`select op_id from backtest_ops where session_id = $1`, [session.id])).length).toBe(0);

    // the same opId with a valid riskPct now places the order
    const ok = await post(orders, orderBody(100));
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { order: { riskPct: number } }).order.riskPct).toBe(100);
    expect(await rows()).toBe(1);
  });

  it('BUG-003 pattern on the levels: a stop 1e-12 from the entry is 422 STOP_DISTANCE_ZERO, not a 500', async () => {
    const session = (await (await post(base, sessionBody())).json()) as { id: string };
    await db.query(`update backtest_sessions set cursor_ms = $2 where id = $1`, [session.id, CURSOR]);
    const res = await post(`${base}/${session.id}/orders`, {
      opId: randomUUID(), cursorMs: CURSOR, panelId: 'p1', side: 'long', type: 'limit', limitPrice: 61_000, sl: 61_000 - 1e-12, riskPct: 1,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: 'STOP_DISTANCE_ZERO', message: expect.any(String) } });
    expect((await post(`${base}/${session.id}/orders`, { opId: randomUUID(), cursorMs: CURSOR, panelId: 'p1', side: 'long', type: 'market', sl: 1e12, riskPct: 1 })).status).toBe(400);
  });
});

import { E2E_ADMIN_EMAIL, E2E_PASSWORD, E2E_ROOT, RUN, restoreE2eEnv } from './e2e-env'; // first: env before config.module loads
import { randomUUID } from 'crypto';
import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Candle } from '@trade-automation/contracts';
import {
  FILL_TABLE_FIXTURES,
  FIXTURE_COSTS_ON,
  FIXTURE_T0,
  FIXTURE_MIN,
  TRADE_RESULT_FIXTURES,
  fixtureTime,
} from '@trade-automation/replay-core';
import { AdminController } from '../../src/api/rest/admin.controller';
import { AuthController } from '../../src/api/rest/auth.controller';
import { AdvanceController } from '../../src/api/rest/backtest/advance.controller';
import { BacktestCandlesController } from '../../src/api/rest/backtest/candles.controller';
import { OrdersController } from '../../src/api/rest/backtest/orders.controller';
import { SessionsController } from '../../src/api/rest/backtest/sessions.controller';
import { StatsController } from '../../src/api/rest/backtest/stats.controller';
import { AuthModule } from '../../src/auth/auth.module';
import { BacktestModule } from '../../src/backtest/backtest.module';
import { AppConfigModule } from '../../src/config/config.module';
import { DB } from '../../src/db/db.port';
import { DbModule } from '../../src/db/db.module';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { StorageModule } from '../../src/storage/storage.module';
import { DB_HOOK_TIMEOUT_MS } from '../db/scratch-db';

/**
 * Tester e2e for the money path of the backtest API (cluster bt-session-api): real Nest
 * controllers + AuthGuard + services + Postgres + file candle store, driven over HTTP the way the
 * client drives them. Expected numbers come from the `libs/replay-core` reference fixtures
 * (design §2.1), never from the code under test:
 *
 *  1. journey — login → create session → limit order → advance to the fill → advance to the exit
 *     → manual close of a second (compounded) order → journal, stats, stored aggregates, drift;
 *  2. end-of-session force close, costs on;
 *  3. the whole §6 fill table (every 1m fixture that can be reached through the API) end to end.
 *
 * Why these are critical: a wrong fill price, size, cost or balance is silent — it corrupts the
 * journal and every statistic built on it. Skipped without DATABASE_URL (like the other
 * integration specs):
 *   DATABASE_URL=postgres://backtest@localhost:5432/backtest_tester npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('backtest-money-flow.e2e.spec.ts: DATABASE_URL not set — skipping real-stack backtest e2e.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = FIXTURE_MIN;
const DAY = 86_400_000;
const BTC = 'binance:BTCUSDT' as const;
const PASSWORD = E2E_PASSWORD;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const bar = (openTime: number, open: number, high: number, low: number, close: number): Candle => ({
  instrument: BTC, timeframe: '1m', openTime, open, high, low, close, volume: 1, closed: true, source: 'venue-rest',
});

// Fill-table fixtures reachable through the API: an untouched pending limit, or a market position
// opened at the placement cursor (t(0)) whose path starts at t(0). Fixtures that pre-seed an order
// in a state the API cannot produce (entry candle before the path, a re-walked fill) are skipped.
function reachable(f: (typeof FILL_TABLE_FIXTURES)[number]): boolean {
  if (f.walk !== '1m' || f.path.length === 0 || f.path[0].openTime !== fixtureTime(0)) return false;
  if (f.order.status === 'pending') return f.order.type === 'limit' && f.order.entryTimeMs === null;
  return f.order.type === 'market' && f.order.entryTimeMs === fixtureTime(-1);
}
const REACHABLE = FILL_TABLE_FIXTURES.filter(reachable);

maybeDescribe('backtest money path over HTTP, real Postgres (Tester e2e, cluster bt-session-api)', () => {
  const run = RUN;
  const adminEmail = E2E_ADMIN_EMAIL;
  const journeyT0 = FIXTURE_T0 + 400 * DAY; // clear of every fixture-table window below
  const root = E2E_ROOT;
  let app: INestApplication;
  let base: string;
  let db: PgDatabase;
  const jars: Record<string, string> = {};

  const call = async (who: string | null, method: string, url: string, body?: unknown): Promise<{ status: number; body: Json }> => {
    const res = await fetch(`${base}/api${url}`, {
      method,
      headers: { 'content-type': 'application/json', ...(who ? { cookie: jars[who] } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (name: string, email: string, password: string) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    jars[name] = res.headers.get('set-cookie')!.split(';')[0];
  };

  const layout = { id: 'one', name: 'One', grid: { columns: 1, rows: 1 }, panels: [{ id: 'p1', kind: 'candles', instrument: BTC }] };
  const createSession = async (who: string, o: { from: number; to: number; costs: Json; balance?: number }) => {
    const r = await call(who, 'POST', '/backtest/sessions', {
      name: 'e2e', layout, timeframe: '1m', periodFromMs: o.from, periodToMs: o.to,
      initialBalance: o.balance ?? 10_000, defaultRiskPct: 1, costs: o.costs, skipWeekends: false,
    });
    expect({ status: r.status, body: r.status === 201 ? null : r.body }).toEqual({ status: 201, body: null });
    return r.body.id as string;
  };
  const place = (who: string, sid: string, cursorMs: number, o: Json) =>
    call(who, 'POST', `/backtest/sessions/${sid}/orders`, { opId: randomUUID(), cursorMs, panelId: 'p1', riskPct: 1, ...o });
  const advance = (who: string, sid: string, toCursorMs: number) =>
    call(who, 'POST', `/backtest/sessions/${sid}/advance`, { opId: randomUUID(), toCursorMs });

  const tradeResult = (name: string) => {
    const f = TRADE_RESULT_FIXTURES.find((x) => x.name === name);
    if (!f) throw new Error(`replay-core fixture renamed or removed: ${name}`);
    return f.expected;
  };

  beforeAll(async () => {
    // ---- the tape: one window per scenario, all BTCUSDT 1m in the temp file store ----
    const tape: Candle[] = [];
    // journey (costs on): lastClose 1000; long limit 995 fills on i=1 and hits the 1020 target on i=3
    const J = (i: number) => journeyT0 + i * MIN;
    tape.push(
      bar(J(-1), 1000, 1000, 1000, 1000),
      bar(J(0), 1000, 1002, 997, 999),
      bar(J(1), 999, 1000, 995, 998),
      bar(J(2), 998, 1010, 996, 1005),
      bar(J(3), 1005, 1022, 1004, 1018),
      bar(J(4), 1018, 1019, 1010, 1012),
    );
    // end-of-session window: lastClose 1000, then the reference LAST_BAR (1004, 1006, 1003, 1005) at i=3
    const E = (i: number) => journeyT0 + 5 * DAY + i * MIN;
    tape.push(
      bar(E(-1), 1000, 1000, 1000, 1000),
      bar(E(0), 1000, 1002, 998, 1001),
      bar(E(1), 1001, 1003, 999, 1002),
      bar(E(2), 1002, 1004, 1000, 1003),
      bar(E(3), 1004, 1006, 1003, 1005),
    );
    // fill table: case k lives k+2 days after FIXTURE_T0 — its own tape, its own session
    REACHABLE.forEach((f, k) => {
      const off = (k + 2) * DAY;
      const half = f.costs.enabled ? f.costs.spread / 2 : 0;
      let lastClose: number;
      if (f.order.status === 'pending') lastClose = f.side === 'long' ? f.order.limitPrice! + 5 : f.order.limitPrice! - 5;
      else lastClose = f.side === 'long' ? f.order.entryPrice! - half : f.order.entryPrice! + half; // market fill = lastClose ± half
      tape.push(bar(fixtureTime(-1) + off, lastClose, lastClose, lastClose, lastClose));
      for (const p of f.path) tape.push(bar(p.openTime + off, p.open, p.high, p.low, p.close));
    });
    await new FileCandleStore(root).upsert(tape);

    @Module({
      imports: [AppConfigModule, DbModule, StorageModule, AuthModule, BacktestModule],
      controllers: [AuthController, AdminController, SessionsController, BacktestCandlesController, OrdersController, AdvanceController, StatsController],
    })
    class E2eModule {}
    app = (await Test.createTestingModule({ imports: [E2eModule] }).compile()).createNestApplication({ logger: false });
    await app.listen(0);
    base = await app.getUrl();
    db = new PgDatabase(DATABASE_URL as string);

    await login('alice', adminEmail, PASSWORD); // the bootstrapped admin doubles as trader "alice"
    const inv = await call('alice', 'POST', '/admin/invites', {});
    const token = String(inv.body.url).split('/invite/')[1];
    const accept = await fetch(`${base}/api/auth/invites/${token}/accept`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `bob-${run}@bt-e2e.test`, password: PASSWORD }),
    });
    expect(accept.status).toBe(201);
    jars.bob = accept.headers.get('set-cookie')!.split(';')[0];
  }, 60_000);

  afterAll(async () => {
    await db?.query(`delete from users where email like $1`, [`%-${run}@bt-e2e.test`]); // cascades to sessions, orders, ops
    await db?.end();
    await (app?.get(DB) as PgDatabase | undefined)?.end(); // the app's own pool: nothing closes it on app.close()
    await app?.close();
    restoreE2eEnv();
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: cascade-deletes this run's users and everything they own

  it('journey: limit fills, hits target, second order compounds on the new balance and is closed by hand', async () => {
    const J = (i: number) => journeyT0 + i * MIN;
    const sid = await createSession('alice', { from: J(0), to: J(20), costs: FIXTURE_COSTS_ON });

    // limit long 995, stop 990, target 1020, 1 % of 10 000 → qty 100 / 5 = 20 (reference SIZING/TRADE_RESULT numbers)
    const placed = await place('alice', sid, J(0), { side: 'long', type: 'limit', limitPrice: 995, sl: 990, tp: 1020 });
    expect(placed.status).toBe(201);
    expect(placed.body.order).toMatchObject({ status: 'pending', qty: 20, riskAmountCcy: 100, seq: 1 });

    const toFill = await advance('alice', sid, J(2)); // walks i=0 (no touch) and i=1 (low 995)
    expect(toFill.status).toBe(200);
    expect(toFill.body.events).toEqual([
      expect.objectContaining({ kind: 'fill', time: J(1), price: 995, resolution: '1m' }),
    ]);
    expect(toFill.body.orders[0]).toMatchObject({ status: 'open', entryPrice: 995, entryTimeMs: J(1) });
    expect(toFill.body.balance).toBe(10_000); // nothing closed yet

    const toExit = await advance('alice', sid, J(4)); // i=2 quiet, i=3 high 1022 ≥ 1020
    const ref = tradeResult('long · limit entry, take-profit · costs on'); // commission 40.3, no spread paid, pnl 459.7, R 4.597
    expect(toExit.body.events).toEqual([expect.objectContaining({ kind: 'exit', time: J(3), price: 1020, reason: 'take-profit' })]);
    expect(toExit.body.orders[0]).toMatchObject({ status: 'closed', closeReason: 'take-profit', exitPrice: 1020, exitTimeMs: J(3), fillResolution: '1m' });
    expect(toExit.body.orders[0].commissionCcy).toBeCloseTo(ref.commissionCcy, 6);
    expect(toExit.body.orders[0].spreadCostCcy).toBeCloseTo(ref.spreadCostCcy, 6);
    expect(toExit.body.orders[0].pnlCcy).toBeCloseTo(ref.pnlCcy, 6);
    expect(toExit.body.orders[0].pnlR).toBeCloseTo(ref.pnlR, 5);
    expect(toExit.body.orders[0].maePrice).toBeCloseTo(0, 6); // never below the 995 entry
    expect(toExit.body.balance).toBeCloseTo(10_000 + ref.pnlCcy, 6); // 10 459.7

    // second order compounds: risk = 1 % of 10 459.7 = 104.597; short market, lastClose 1018 → entry 1017 (spread 1),
    // stop 1030 → qty = 104.597 / |1018 - 1030| ; closed by hand after i=4 (close 1012) → exit 1012 + 1 = 1013
    const balance = 10_000 + ref.pnlCcy;
    const second = await place('alice', sid, J(4), { side: 'short', type: 'market', sl: 1030 });
    expect(second.status).toBe(201);
    const qty2 = (balance * 0.01) / 12;
    expect(second.body.order.riskAmountCcy).toBeCloseTo(balance * 0.01, 6);
    expect(second.body.order.qty).toBeCloseTo(qty2, 6);
    expect(second.body.order).toMatchObject({ status: 'open', entryPrice: 1017, seq: 2 });
    const step = await advance('alice', sid, J(5)); // walks i=4 only: no stop, no target
    expect(step.body.events).toEqual([]);
    const closed = await call('alice', 'POST', `/backtest/sessions/${sid}/orders/${second.body.order.id}/close`, { opId: randomUUID(), cursorMs: J(5) });
    expect(closed.status).toBe(200);
    const fee2 = 0.001 * (1017 * qty2 + 1013 * qty2);
    const pnl2 = (1017 - 1013) * qty2 - fee2;
    expect(closed.body.order).toMatchObject({ status: 'closed', closeReason: 'manual', exitPrice: 1013 });
    expect(closed.body.order.commissionCcy).toBeCloseTo(fee2, 4);
    expect(closed.body.order.pnlCcy).toBeCloseTo(pnl2, 4);
    expect(closed.body.order.pnlR).toBeCloseTo(pnl2 / (balance * 0.01), 4);
    const finalBalance = balance + pnl2;
    expect(closed.body.balance).toBeCloseTo(finalBalance, 4);

    // journal in placement order, closed trades only
    const journal = await call('alice', 'GET', `/backtest/sessions/${sid}/orders`);
    expect(journal.body.map((o: Json) => [o.seq, o.status])).toEqual([[1, 'closed'], [2, 'closed']]);

    // statistics: recomputed, stored, and the two agree
    const stats = await call('alice', 'GET', `/backtest/sessions/${sid}/stats`);
    expect(stats.status).toBe(200);
    const c = stats.body.computed;
    expect(stats.body.drift).toBe(false);
    expect(pnl2).toBeGreaterThan(0); // 4 × qty gross beats the 2.03 × qty commission: two winners, so no profit factor yet
    expect(c).toMatchObject({ trades: 2, wins: 2, losses: 0, profitFactor: null });
    expect(c.pnl).toBeCloseTo(ref.pnlCcy + pnl2, 4);
    expect(c.equityCurve.map((p: Json) => p.time)).toEqual([J(0), J(3), J(5) - MIN]); // start, exit of #1, exit of #2
    expect(c.equityCurve[0].balance).toBe(10_000);
    expect(c.equityCurve[1].balance).toBeCloseTo(balance, 6);
    expect(c.equityCurve[2].balance).toBeCloseTo(finalBalance, 4);
    expect(stats.body.stored).toMatchObject({ tradesCount: 2, winsCount: 2, lossesCount: 0, profitFactor: null });
    expect(stats.body.stored.pnlCcy).toBeCloseTo(ref.pnlCcy + pnl2, 4);

    // the list screen shows the same aggregates and the same balance
    const list = await call('alice', 'GET', '/backtest/sessions');
    const row = list.body.find((s: Json) => s.id === sid);
    expect(row.balance).toBeCloseTo(finalBalance, 4);
    expect(row.pnlCcy).toBeCloseTo(ref.pnlCcy + pnl2, 4);

    // tenancy: another user gets nothing about this journal, and cannot move its money
    expect((await call('bob', 'GET', `/backtest/sessions/${sid}/stats`)).status).toBe(404);
    expect((await call('bob', 'GET', `/backtest/sessions/${sid}/orders`)).status).toBe(404);
    expect((await call('bob', 'POST', `/backtest/sessions/${sid}/advance`, { opId: randomUUID(), toCursorMs: J(6) })).status).toBe(404);
    expect((await call(null, 'GET', `/backtest/sessions/${sid}/stats`)).status).toBe(401);
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: ~20 HTTP requests, each a Postgres transaction — timed out twice at load 180+

  it('end of session: the open position is force-closed at the last close, spread and commission applied', async () => {
    const E = (i: number) => journeyT0 + 5 * DAY + i * MIN;
    const sid = await createSession('alice', { from: E(0), to: E(4), costs: FIXTURE_COSTS_ON });
    // long market at lastClose 1000 → entry 1001; stop 990 → qty 100 / 10 = 10
    const placed = await place('alice', sid, E(0), { side: 'long', type: 'market', sl: 990 });
    expect(placed.body.order).toMatchObject({ status: 'open', entryPrice: 1001, qty: 10 });
    const pending = await place('alice', sid, E(0), { side: 'long', type: 'limit', limitPrice: 900, sl: 890 });
    expect(pending.body.order.status).toBe('pending');

    const end = await advance('alice', sid, E(4) + 60 * MIN); // beyond the period: clamped to E(4), session completes
    expect(end.body).toMatchObject({ cursorMs: E(4), status: 'complete' });
    const ref = tradeResult('long · market entry, end-of-session exit · costs on'); // exit 1005 - 1 = 1004; pnl 9.95, R 0.0995
    const eos = end.body.orders.find((o: Json) => o.id === placed.body.order.id);
    expect(eos).toMatchObject({ status: 'closed', closeReason: 'end-of-session', exitPrice: 1004 });
    expect(eos.commissionCcy).toBeCloseTo(ref.commissionCcy, 6);
    expect(eos.spreadCostCcy).toBeCloseTo(ref.spreadCostCcy, 6);
    expect(eos.pnlCcy).toBeCloseTo(ref.pnlCcy, 6);
    expect(eos.pnlR).toBeCloseTo(ref.pnlR, 5);
    expect(end.body.orders.find((o: Json) => o.id === pending.body.order.id)).toMatchObject({ status: 'cancelled' });
    expect(end.body.balance).toBeCloseTo(10_000 + ref.pnlCcy, 6);

    expect((await advance('alice', sid, E(4))).status).toBe(409); // complete: nothing moves any more
    const stats = await call('alice', 'GET', `/backtest/sessions/${sid}/stats`);
    expect(stats.body.drift).toBe(false);
    expect(stats.body.computed).toMatchObject({ trades: 1, endOfSessionCloses: 1 });
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: a session, two places, advances and stats over HTTP — the journey's pattern

  it('the §6 fill table, end to end: every reachable 1m fixture yields its reference events and no others', async () => {
    // guard against silent shrinkage: the fixture list may grow, but the API-reachable share must not vanish
    expect(REACHABLE.length).toBeGreaterThanOrEqual(50);

    for (let k = 0; k < REACHABLE.length; k++) {
      const f = REACHABLE[k];
      const off = (k + 2) * DAY;
      const at = (t: number) => t + off;
      const sid = await createSession('alice', { from: at(fixtureTime(0)), to: at(fixtureTime(0)) + 240 * MIN, costs: f.costs });

      const level = f.order.status === 'pending' ? { type: 'limit', limitPrice: f.order.limitPrice } : { type: 'market' };
      const placed = await place('alice', sid, at(fixtureTime(0)), {
        side: f.side, ...level, sl: f.order.slCurrent, ...(f.order.tpCurrent === null ? {} : { tp: f.order.tpCurrent }),
      });
      const label = `${f.name} (placement)`;
      expect({ label, status: placed.status }).toEqual({ label, status: 201 });
      if (f.order.status === 'open') expect({ label, entry: placed.body.order.entryPrice }).toEqual({ label, entry: f.order.entryPrice });

      const last = f.path[f.path.length - 1].openTime;
      const res = await advance('alice', sid, at(last) + MIN);
      expect({ label: f.name, status: res.status }).toEqual({ label: f.name, status: 200 });

      const got = (res.body.events as Json[]).map((e) => ({ kind: e.kind, time: e.time, price: e.price, reason: e.reason, resolution: e.resolution }));
      const want = f.expected.map((e) => ({ kind: e.kind, time: at(e.time), price: e.price, reason: e.reason, resolution: e.resolution }));
      expect({ label: f.name, events: got.length }).toEqual({ label: f.name, events: want.length });
      got.forEach((g, i) => {
        expect({ label: f.name, i, kind: g.kind, time: g.time, reason: g.reason, resolution: g.resolution })
          .toEqual({ label: f.name, i, kind: want[i].kind, time: want[i].time, reason: want[i].reason, resolution: want[i].resolution });
        expect({ label: f.name, i, price: g.price }).toEqual({ label: f.name, i, price: expect.closeTo(want[i].price, 6) });
      });

      // the journal row agrees with the events, and the same-candle flag is set exactly when the fixture says so
      const row = (await call('alice', 'GET', `/backtest/sessions/${sid}/orders/${placed.body.order.id}`)).body.order;
      const exit = f.expected.find((e) => e.kind === 'exit');
      if (exit) {
        expect({ label: f.name, status: row.status, reason: row.closeReason, sameBar: row.slTpSameBar })
          .toEqual({ label: f.name, status: 'closed', reason: exit.reason, sameBar: exit.slTpSameBar === true });
        expect({ label: f.name, exit: row.exitPrice }).toEqual({ label: f.name, exit: expect.closeTo(exit.price, 6) });
      } else {
        expect({ label: f.name, status: row.status }).toEqual({ label: f.name, status: f.expected.some((e) => e.kind === 'fill') ? 'open' : f.order.status });
      }
    }
  }, 120_000);
  it('regressions BUG-002/003/004: out-of-range numbers are 400 and do not burn the opId; an opId reused for another request is 409 and moves nothing', async () => {
    const J = (i: number) => journeyT0 + i * MIN;
    const sid = await createSession('alice', { from: J(0), to: J(20), costs: FIXTURE_COSTS_ON });
    const bad = await call('alice', 'POST', '/backtest/sessions', {
      name: 'x', layout, timeframe: '1m', periodFromMs: J(0), periodToMs: J(20), initialBalance: 1e13, defaultRiskPct: 10_000, costs: FIXTURE_COSTS_ON,
    });
    expect(bad.status).toBe(400); // was a 500 "numeric field overflow"

    const op = randomUUID();
    const body = { opId: op, cursorMs: J(0), panelId: 'p1', side: 'long', type: 'market', sl: 990, riskPct: 1 };
    expect((await call('alice', 'POST', `/backtest/sessions/${sid}/orders`, { ...body, riskPct: 10_000 })).status).toBe(400);
    const ok = await call('alice', 'POST', `/backtest/sessions/${sid}/orders`, body); // same opId, valid body: not burnt
    expect(ok.status).toBe(201);
    const retry = await call('alice', 'POST', `/backtest/sessions/${sid}/orders`, body);
    expect(retry.status).toBe(201);
    expect(retry.body.order.id).toBe(ok.body.order.id); // identical retry replays

    expect((await call('alice', 'POST', `/backtest/sessions/${sid}/orders`, { ...body, sl: 980 })).status).toBe(409); // same opId, other body
    const stolen = await call('alice', 'POST', `/backtest/sessions/${sid}/advance`, { opId: op, toCursorMs: J(3) }); // same opId, other operation
    expect(stolen.status).toBe(409);
    const detail = await call('alice', 'GET', `/backtest/sessions/${sid}`);
    expect(detail.body.session.cursorMs).toBe(J(0)); // the rejected advance moved nothing
    expect((await call('alice', 'GET', `/backtest/sessions/${sid}/orders`)).body).toHaveLength(1);
  });

  it('regression BUG-005: a burst of parallel wrong logins is throttled after 10, not evaluated in full', async () => {
    const email = `burst-${RUN}@bt-e2e.test`;
    const attempts = await Promise.all(
      Array.from({ length: 60 }, () =>
        fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'wrong-password-1' }) }).then((r) => r.status),
      ),
    );
    expect(attempts.filter((s) => s === 401).length).toBeLessThanOrEqual(10);
    expect(attempts.filter((s) => s === 429).length).toBeGreaterThanOrEqual(50);
    expect(attempts.every((s) => s === 401 || s === 429)).toBe(true);
    // the bootstrapped admin is a different key and unaffected
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: adminEmail, password: PASSWORD }) });
    expect(res.status).toBe(200);
  });
});

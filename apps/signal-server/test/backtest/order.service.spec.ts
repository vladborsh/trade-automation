import { randomUUID } from 'crypto';
import { Candle, PlaceOrderRequest, SessionSummary } from '@trade-automation/contracts';
import { computeStats, toSessionAggregates } from '@trade-automation/replay-core';
import { OrderService } from '../../src/backtest/order.service';
import { FakeBacktestRepositories, candleStore, createBody, m1, makeSessionService } from './fake-backtest';

const MIN = 60_000;
const BTC = 'binance:BTCUSDT' as const;

/**
 * Tape around the session start C = periodFromMs (createBody: costs on, commission 0.04 %,
 * spread 0.5 → half 0.25; balance 10 000, risk 1 %). lastClose at C is 100 (the C-1m candle).
 * After the cursor moves to C+3m, lastClose is 102 (the C+2m candle).
 */
function tape(C: number): Candle[] {
  return [
    m1(BTC, C - 2 * MIN, 100, 101, 99, 100),
    m1(BTC, C - MIN, 100, 100.5, 97, 100), // entry candle of a market order at C; low 97 must not enter MAE
    m1(BTC, C, 100, 100.4, 99.8, 100.2),
    m1(BTC, C + MIN, 100.2, 100.3, 98.5, 99),
    m1(BTC, C + 2 * MIN, 99, 102.2, 99, 102),
  ];
}

async function setup(costs?: { enabled: boolean; commissionPct: number; spread: number }) {
  const repos = new FakeBacktestRepositories();
  const sessions = makeSessionService(repos);
  const session = await sessions.create('alice', createBody(costs ? { costs } : {}));
  const store = candleStore(tape(session.periodFromMs));
  const orders = new OrderService(repos, store);
  const row = () => repos.rows.get(session.id)!.session as SessionSummary;
  const place = (over: Partial<PlaceOrderRequest> = {}) =>
    orders.place('alice', session.id, {
      opId: randomUUID(), cursorMs: row().cursorMs, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1, ...over,
    });
  return { repos, sessions, session, orders, row, place };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: { getStatus(): number; getResponse(): unknown }) => {
      const body = e.getResponse() as { error?: { code: string } };
      return `${e.getStatus()} ${body.error?.code ?? ''}`.trim();
    },
  );

describe('OrderService.place (design §7.2, §6)', () => {
  it('market long, costs on: fills at lastClose + half, entry_time = last revealed candle, sized by positionSize', async () => {
    const { place, session } = await setup();
    const { order, events } = await place();

    // riskAmount = 10 000 * 1 % = 100; qty = 100 / |100 - 99| = 100; entry 100 + 0.25
    expect(order).toMatchObject({
      seq: 1, status: 'open', type: 'market', side: 'long', entryPrice: 100.25, entryTimeMs: session.periodFromMs - MIN,
      qty: 100, riskAmountCcy: 100, riskPct: 1, slInitial: 99, slCurrent: 99, tpInitial: null, fillResolution: '1m',
      placedAtMs: session.periodFromMs, limitPrice: null, instrument: BTC, panelId: 'btc',
    });
    expect(events).toEqual([{ orderId: order.id, kind: 'fill', time: session.periodFromMs - MIN, price: 100.25, resolution: '1m' }]);
  });

  it('market fill price: short with costs on pays the half-spread below, costs off fills at lastClose', async () => {
    expect((await (await setup()).place({ side: 'short', sl: 101 })).order.entryPrice).toBe(99.75);
    const off = await setup({ enabled: false, commissionPct: 0.04, spread: 0.5 });
    expect((await off.place()).order.entryPrice).toBe(100);
    expect((await off.place({ side: 'short', sl: 101 })).order.entryPrice).toBe(100);
  });

  it('a limit order is pending, sized from the limit level, with no events', async () => {
    const { place } = await setup();
    const { order, events } = await place({ type: 'limit', limitPrice: 99.5, sl: 99, tp: 101 });
    // qty = 100 / |99.5 - 99| = 200
    expect(order).toMatchObject({ status: 'pending', limitPrice: 99.5, entryPrice: null, entryTimeMs: null, qty: 200, tpCurrent: 101, fillResolution: null });
    expect(events).toEqual([]);
  });

  it('assigns seq 1, 2, 3 in placement order; the journal lists by seq and filters by status', async () => {
    const { place, orders, session } = await setup();
    const a = await place();
    const b = await place({ type: 'limit', limitPrice: 99.5 });
    const c = await place({ side: 'short', sl: 101 });
    expect([a, b, c].map((r) => r.order.seq)).toEqual([1, 2, 3]);
    expect((await orders.list('alice', session.id)).map((o) => o.seq)).toEqual([1, 2, 3]);
    expect((await orders.list('alice', session.id, 'pending')).map((o) => o.id)).toEqual([b.order.id]);
    await expect(code(orders.list('alice', session.id, 'bogus'))).resolves.toBe('400');
  });

  it('each refusal code', async () => {
    const { place, row } = await setup();
    await expect(code(place({ cursorMs: row().cursorMs + MIN }))).resolves.toBe('409 CURSOR_MISMATCH');
    await expect(code(place({ panelId: 'nope' }))).resolves.toBe('400');
    await expect(code(place({ type: 'limit', limitPrice: 100.5 }))).resolves.toBe('422 LIMIT_ON_WRONG_SIDE');
    await expect(code(place({ sl: 100 }))).resolves.toBe('422 STOP_DISTANCE_ZERO');
    await expect(code(place({ sl: 101 }))).resolves.toBe('422 SL_ON_WRONG_SIDE');
    await expect(code(place({ tp: 99.5 }))).resolves.toBe('422 TP_ON_WRONG_SIDE');

    row().balance = 0;
    await expect(code(place())).resolves.toBe('422 BALANCE_NOT_POSITIVE');
    row().balance = 10_000;

    row().cursorMs = row().periodFromMs - 3 * MIN; // before any candle is revealed
    await expect(code(place())).resolves.toBe('422 NO_PRICE_AT_CURSOR');

    row().status = 'complete';
    await expect(code(place())).resolves.toBe('409 SESSION_COMPLETE');
  });

  it("another user's session is a 404, and a refused request writes nothing", async () => {
    const { orders, session, repos, place } = await setup();
    await expect(
      code(orders.place('bob', session.id, { opId: randomUUID(), cursorMs: session.cursorMs, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1 })),
    ).resolves.toBe('404');
    await code(place({ sl: 101 }));
    expect(repos.orderRows.size).toBe(0);
    expect(repos.opRows.size).toBe(0);
  });

  it('D9: a repeated opId replays the stored response and creates no second order', async () => {
    const { orders, session, repos } = await setup();
    const req: PlaceOrderRequest = { opId: randomUUID(), cursorMs: session.cursorMs, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1 };
    const first = await orders.place('alice', session.id, req);
    const second = await orders.place('alice', session.id, req);
    expect(second).toEqual(first);
    expect(repos.orderRows.size).toBe(1);
  });
});

describe('OrderService.place — BUG-003 bounds on computed values', () => {
  it('a stop 1e-12 from the entry is 422 STOP_DISTANCE_ZERO (it used to size qty ≈ 1e14 and overflow)', async () => {
    const { place, repos } = await setup();
    await expect(code(place({ sl: 100 - 1e-12 }))).resolves.toBe('422 STOP_DISTANCE_ZERO');
    await expect(code(place({ sl: 99.9999 }))).resolves.toBe('422 STOP_DISTANCE_ZERO'); // inside the 0.001 minimum
    const atMinimum = await place({ sl: 99.999 }); // exactly the minimum: qty = 100 / 0.001 (float: 99 999.9999995)
    expect(atMinimum.order.qty).toBeCloseTo(100_000, 3);
    expect(repos.orderRows.size).toBe(1);
  });

  it('a size that would not fit numeric(20,8) is refused with the same code (backstop)', async () => {
    const { place, row } = await setup();
    row().balance = 999_999_999_999; // 100 % risk → 1R ≈ 1e12, qty = 1e12 / 0.001 ≈ 1e15
    await expect(code(place({ sl: 99.999, riskPct: 100 }))).resolves.toBe('422 STOP_DISTANCE_ZERO');
  });

  it('a refused request does not burn its opId: the same opId with a valid body then succeeds', async () => {
    const { orders, session, repos } = await setup();
    const opId = randomUUID();
    const base = { opId, cursorMs: session.cursorMs, panelId: 'btc', side: 'long' as const, type: 'market' as const, riskPct: 1 };
    await expect(code(orders.place('alice', session.id, { ...base, sl: 100 - 1e-12 }))).resolves.toBe('422 STOP_DISTANCE_ZERO');
    expect(repos.opRows.size).toBe(0);
    await expect(orders.place('alice', session.id, { ...base, sl: 99 })).resolves.toMatchObject({ order: { seq: 1 } });
    expect(repos.opRows.size).toBe(1);
  });
});

describe('OrderService.cancel', () => {
  it('cancels a pending order at the cursor; anything else is 409 ORDER_NOT_PENDING; replay is stable', async () => {
    const { place, orders, session } = await setup();
    const limit = (await place({ type: 'limit', limitPrice: 99.5 })).order;
    const market = (await place()).order;
    const req = { opId: randomUUID(), cursorMs: session.cursorMs };

    const cancelled = await orders.cancel('alice', session.id, limit.id, req);
    expect(cancelled).toMatchObject({ id: limit.id, status: 'cancelled', cancelledAtMs: session.cursorMs });
    expect(await orders.cancel('alice', session.id, limit.id, req)).toEqual(cancelled);

    await expect(code(orders.cancel('alice', session.id, limit.id, { ...req, opId: randomUUID() }))).resolves.toBe('409 ORDER_NOT_PENDING');
    await expect(code(orders.cancel('alice', session.id, market.id, { ...req, opId: randomUUID() }))).resolves.toBe('409 ORDER_NOT_PENDING');
    await expect(code(orders.cancel('alice', session.id, randomUUID(), { ...req, opId: randomUUID() }))).resolves.toBe('404');
    await expect(code(orders.cancel('alice', session.id, limit.id, { opId: randomUUID(), cursorMs: 1 }))).resolves.toBe('409 CURSOR_MISMATCH');
  });
});

describe('OrderService.close (manual close)', () => {
  it('exits at lastClose - half, books costs/PnL/R/MAE, updates balance and aggregates', async () => {
    const { place, orders, session, row, repos } = await setup();
    const long = (await place()).order; // entry 100.25, qty 100, 1R = 100
    row().cursorMs = session.periodFromMs + 3 * MIN; // lastClose now 102 (the C+2m candle)

    const res = await orders.close('alice', session.id, long.id, { opId: randomUUID(), cursorMs: row().cursorMs });

    // exit 102 - 0.25 = 101.75; gross (101.75 - 100.25) * 100 = 150;
    // commission 0.04 % of 10 025 + 0.04 % of 10 175 = 4.01 + 4.07 = 8.08 → pnl 141.92, R 1.4192;
    // spread paid on both sides: 0.25 * 100 * 2 = 50.
    // MAE (market: after the entry candle): lows 99.8, 98.5, 99 → 100.25 - 98.5 = 1.75 → 1.75R.
    expect(res.order).toMatchObject({
      status: 'closed', closeReason: 'manual', exitPrice: 101.75, exitTimeMs: session.periodFromMs + 2 * MIN,
      fillResolution: '1m', spreadCostCcy: 50, maePrice: 1.75,
    });
    expect(res.order.commissionCcy).toBeCloseTo(8.08, 8);
    expect(res.order.pnlCcy).toBeCloseTo(141.92, 8);
    expect(res.order.pnlR).toBeCloseTo(1.4192, 6);
    expect(res.order.maeR).toBeCloseTo(1.75, 6);

    expect(res.balance).toBeCloseTo(10_141.92, 8);
    expect(row().balance).toBe(res.balance);
    const expectedStats = computeStats(await repos.orders.listClosedForStats(session.id), session.initialBalance, session.periodFromMs);
    expect(res.stats).toEqual(expectedStats);
    const { statsComputedAt: _t, ...aggregates } = toSessionAggregates(expectedStats, null);
    expect(row()).toMatchObject(aggregates);
    expect(row()).toMatchObject({ tradesCount: 1, winsCount: 1, pnlCcy: res.order.pnlCcy });
  });

  it('only an open order: pending/closed are 409 ORDER_NOT_OPEN; a replayed close returns the stored response', async () => {
    const { place, orders, session } = await setup();
    const limit = (await place({ type: 'limit', limitPrice: 99.5 })).order;
    const long = (await place()).order;
    const req = { opId: randomUUID(), cursorMs: session.cursorMs };

    await expect(code(orders.close('alice', session.id, limit.id, { ...req, opId: randomUUID() }))).resolves.toBe('409 ORDER_NOT_OPEN');
    const first = await orders.close('alice', session.id, long.id, req);
    expect(await orders.close('alice', session.id, long.id, req)).toEqual(first);
    await expect(code(orders.close('alice', session.id, long.id, { ...req, opId: randomUUID() }))).resolves.toBe('409 ORDER_NOT_OPEN');
  });
});

describe('GET order detail and the session detail', () => {
  it('order detail carries modifications and an empty screenshots object; openOrders = pending + open', async () => {
    const { place, orders, session, sessions } = await setup();
    const limit = (await place({ type: 'limit', limitPrice: 99.5 })).order;
    const long = (await place()).order;
    const shortClosed = (await place({ side: 'short', sl: 101 })).order;
    await orders.close('alice', session.id, shortClosed.id, { opId: randomUUID(), cursorMs: session.cursorMs });

    expect(await orders.get('alice', session.id, long.id)).toEqual({ order: long, modifications: [], screenshots: {} });
    await expect(code(orders.get('bob', session.id, long.id))).resolves.toBe('404');
    await expect(code(orders.get('alice', session.id, 'not-a-uuid'))).resolves.toBe('404');
    expect((await sessions.detail('alice', session.id)).openOrders.map((o) => o.id)).toEqual([limit.id, long.id]);
  });
});

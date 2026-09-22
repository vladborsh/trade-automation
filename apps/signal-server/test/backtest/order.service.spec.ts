import { randomUUID } from 'crypto';
import { Candle, PlaceOrderRequest, SessionSummary } from '@trade-automation/contracts';
import { computeStats, toSessionAggregates } from '@trade-automation/replay-core';
import { OrderService } from '../../src/backtest/order.service';
import { FakeBacktestRepositories, candleStore, createBody, m1, makeSessionService, fakeInstrumentConfig } from './fake-backtest';

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
  const orders = new OrderService(repos, store, fakeInstrumentConfig());
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
    // exactly the minimum distance is accepted. At 0.01 % risk: qty = 1 / 0.001 = 1 000 BTC (float 999.9999999995,
    // kept on its 0.001 step), 100 000 notional, 800 margin at 125× (at 1 % it would need 80 000: INSUFFICIENT_MARGIN)
    const atMinimum = await place({ sl: 99.999, riskPct: 0.01 });
    expect(atMinimum.order.qty).toBe(1000);
    expect(repos.orderRows.size).toBe(1);
  });

  it('a size that would not fit numeric(20,8) is refused before it reaches the column (D12: margin first)', async () => {
    const { place, row } = await setup();
    row().balance = 999_999_999_999; // 100 % risk → 1R ≈ 1e12, qty = 1e12 / 0.001 ≈ 1e15
    // D12 refuses on margin before the overflow backstop (§6 order): 1e15 × 100 / 125 is far beyond the balance.
    // The STOP_DISTANCE_ZERO backstop stays for what margin cannot catch (a huge size at a tiny price).
    await expect(code(place({ sl: 99.999, riskPct: 100 }))).resolves.toBe('422 INSUFFICIENT_MARGIN');
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

describe('OrderService — BUG-004 opId reuse', () => {
  it('the same opId with a different body is 409 and writes nothing; the identical retry still replays', async () => {
    const { orders, session, repos } = await setup();
    const req: PlaceOrderRequest = { opId: randomUUID(), cursorMs: session.cursorMs, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1 };
    const first = await orders.place('alice', session.id, req);
    await expect(code(orders.place('alice', session.id, { ...req, riskPct: 2 }))).resolves.toBe('409');
    await expect(orders.place('alice', session.id, { ...req })).resolves.toEqual(first);
    expect(repos.orderRows.size).toBe(1);
  });

  it('a cancel opId reused for another order, or for a close, is 409', async () => {
    const { place, orders, session } = await setup();
    const a = (await place({ type: 'limit', limitPrice: 99.5 })).order;
    const b = (await place({ type: 'limit', limitPrice: 99.4 })).order;
    const long = (await place()).order;
    const req = { opId: randomUUID(), cursorMs: session.cursorMs };
    await orders.cancel('alice', session.id, a.id, req);
    await expect(code(orders.cancel('alice', session.id, b.id, req))).resolves.toBe('409');
    await expect(code(orders.close('alice', session.id, long.id, req))).resolves.toBe('409');
    expect((await orders.get('alice', session.id, b.id)).order.status).toBe('pending');
    expect((await orders.get('alice', session.id, long.id)).order.status).toBe('open');
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

describe('OrderService.modify (T-033, decision 23)', () => {
  const mod = (orders: OrderService, sessionId: string, orderId: string, body: { cursorMs: number; sl?: number; tp?: number; opId?: string }) =>
    orders.modify('alice', sessionId, orderId, { opId: randomUUID(), ...body });

  it('open long: break-even and a trailing stop into profit are accepted, one row per changed field at the cursor', async () => {
    const { place, orders, session, row } = await setup();
    const long = (await place({ tp: 110 })).order; // entry 100.25, sl 99, riskAmount 100
    row().cursorMs = session.periodFromMs + 3 * MIN; // lastClose 102

    const be = await mod(orders, session.id, long.id, { cursorMs: row().cursorMs, sl: 100.25 });
    expect(be).toMatchObject({ slCurrent: 100.25, slInitial: 99, tpCurrent: 110, riskAmountCcy: 100, qty: 100, status: 'open' });
    const trail = await mod(orders, session.id, long.id, { cursorMs: row().cursorMs, sl: 101, tp: 105 });
    expect(trail).toMatchObject({ slCurrent: 101, slInitial: 99, tpCurrent: 105, tpInitial: 110, riskAmountCcy: 100 });

    const detail = await orders.get('alice', session.id, long.id);
    expect(detail.order).toEqual(trail);
    expect(detail.modifications.map(({ field, oldValue, newValue, cursorMs }) => ({ field, oldValue, newValue, cursorMs }))).toEqual([
      { field: 'sl', oldValue: 99, newValue: 100.25, cursorMs: row().cursorMs },
      { field: 'sl', oldValue: 100.25, newValue: 101, cursorMs: row().cursorMs },
      { field: 'tp', oldValue: 110, newValue: 105, cursorMs: row().cursorMs },
    ]);
  });

  it('open: a level at or through the last close is 422; a refusal writes nothing', async () => {
    const { place, orders, session, row, repos } = await setup();
    const long = (await place()).order;
    const short = (await place({ side: 'short', sl: 101 })).order; // entry 99.75
    row().cursorMs = session.periodFromMs + 3 * MIN; // lastClose 102
    const c = row().cursorMs;

    await expect(code(mod(orders, session.id, long.id, { cursorMs: c, sl: 102 }))).resolves.toBe('422 STOP_DISTANCE_ZERO');
    await expect(code(mod(orders, session.id, long.id, { cursorMs: c, sl: 102.5 }))).resolves.toBe('422 SL_ON_WRONG_SIDE');
    await expect(code(mod(orders, session.id, long.id, { cursorMs: c, tp: 101.5 }))).resolves.toBe('422 TP_ON_WRONG_SIDE');
    await expect(code(mod(orders, session.id, short.id, { cursorMs: c, sl: 101.5 }))).resolves.toBe('422 SL_ON_WRONG_SIDE'); // the short is losing: 101.5 is through 102
    await expect(code(mod(orders, session.id, short.id, { cursorMs: c, tp: 102.5 }))).resolves.toBe('422 TP_ON_WRONG_SIDE');
    expect((await orders.get('alice', session.id, long.id)).order).toMatchObject({ slCurrent: 99, tpCurrent: null });
    expect(repos.modificationRows).toEqual([]);
  });

  it('pending: checked against the limit as at placement, whatever the market', async () => {
    const { place, orders, session } = await setup();
    const limit = (await place({ type: 'limit', limitPrice: 99.5, sl: 99, tp: 101 })).order; // lastClose 100
    const c = session.cursorMs;
    await expect(code(mod(orders, session.id, limit.id, { cursorMs: c, sl: 99.6 }))).resolves.toBe('422 SL_ON_WRONG_SIDE'); // below the market, above the limit
    await expect(code(mod(orders, session.id, limit.id, { cursorMs: c, sl: 99.5 }))).resolves.toBe('422 STOP_DISTANCE_ZERO');
    await expect(code(mod(orders, session.id, limit.id, { cursorMs: c, tp: 99.4 }))).resolves.toBe('422 TP_ON_WRONG_SIDE');
    expect(await mod(orders, session.id, limit.id, { cursorMs: c, sl: 98.5, tp: 99.8 })).toMatchObject({
      status: 'pending', slCurrent: 98.5, tpCurrent: 99.8, slInitial: 99, qty: 200, riskAmountCcy: 100,
    });
  });

  it('closed or cancelled is 409 ORDER_NOT_ACTIVE; the cursor, completion and an empty body are checked first', async () => {
    const { place, orders, session, row } = await setup();
    const limit = (await place({ type: 'limit', limitPrice: 99.5 })).order;
    const long = (await place()).order;
    const c = session.cursorMs;
    await orders.cancel('alice', session.id, limit.id, { opId: randomUUID(), cursorMs: c });
    await orders.close('alice', session.id, long.id, { opId: randomUUID(), cursorMs: c });

    await expect(code(mod(orders, session.id, limit.id, { cursorMs: c, sl: 98 }))).resolves.toBe('409 ORDER_NOT_ACTIVE');
    await expect(code(mod(orders, session.id, long.id, { cursorMs: c, sl: 98 }))).resolves.toBe('409 ORDER_NOT_ACTIVE');
    await expect(code(mod(orders, session.id, long.id, { cursorMs: c + MIN, sl: 98 }))).resolves.toBe('409 CURSOR_MISMATCH');
    await expect(code(mod(orders, session.id, randomUUID(), { cursorMs: c, sl: 98 }))).resolves.toBe('404');
    await expect(code(mod(orders, session.id, long.id, { cursorMs: c }))).resolves.toBe('400');
    row().status = 'complete';
    await expect(code(mod(orders, session.id, long.id, { cursorMs: c, sl: 98 }))).resolves.toBe('409 SESSION_COMPLETE');
  });

  it('D9: a replayed opId returns the stored order and writes no second row; a move to the current value writes none', async () => {
    const { place, orders, session, repos } = await setup();
    const long = (await place({ tp: 110 })).order;
    const req = { opId: randomUUID(), cursorMs: session.cursorMs, sl: 98 };
    const first = await orders.modify('alice', session.id, long.id, req);
    expect(await orders.modify('alice', session.id, long.id, req)).toEqual(first);
    expect(repos.modificationRows).toHaveLength(1);
    await expect(code(orders.modify('alice', session.id, long.id, { ...req, sl: 97 }))).resolves.toBe('409'); // BUG-004

    const same = await mod(orders, session.id, long.id, { cursorMs: session.cursorMs, sl: 98, tp: 110 });
    expect(same).toMatchObject({ slCurrent: 98, tpCurrent: 110 });
    expect(repos.modificationRows).toHaveLength(1);
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Candle, InstrumentId, PlaceOrderRequest, SessionSummary, Timeframe } from '@trade-automation/contracts';
import { computeStats, toSessionAggregates } from '@trade-automation/replay-core';
import { AdvanceService } from '../../src/backtest/advance.service';
import { OrderService } from '../../src/backtest/order.service';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { DAY, FakeBacktestRepositories, T0, createBody, makeSessionService } from './fake-backtest';

const MIN = 60_000;
const BTC: InstrumentId = 'binance:BTCUSDT';
const ETH: InstrumentId = 'binance:ETHUSDT';
/** createBody: period T0+5d → T0+10d, tf 15m, BTC + ETH panels, balance 10 000, risk 1 %, commission 0.04 %, spread 0.5 (half 0.25). */
const C = T0 + 5 * DAY;
const PERIOD_TO = T0 + 10 * DAY;

type Row = [number, number, number, number]; // o h l c

function bar(instrument: InstrumentId, timeframe: Timeframe, openTime: number, [o, h, l, c]: Row): Candle {
  return { instrument, timeframe, openTime, open: o, high: h, low: l, close: c, volume: 1, closed: true, source: 'venue-rest' };
}

/**
 * A fixture 1m tape in a real FileCandleStore: `minutes` flat candles at 100 (h 100.1, l 99.9)
 * starting at `from`, with `overrides[i]` replacing minute `i` (relative to C).
 */
async function tape(store: FileCandleStore, instrument: InstrumentId, from: number, minutes: number, overrides: Record<number, Row> = {}) {
  const bars: Candle[] = [];
  for (let t = from; t < from + minutes * MIN; t += MIN) {
    const i = (t - C) / MIN;
    bars.push(bar(instrument, '1m', t, overrides[i] ?? [100, 100.1, 99.9, 100]));
  }
  await store.upsert(bars);
}

describe('AdvanceService (design §5.5) against a fixture 1m tape in the file store', () => {
  let root: string;
  let store: FileCandleStore;
  let repos: FakeBacktestRepositories;
  let orders: OrderService;
  let advancer: AdvanceService;
  let session: SessionSummary;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'advance-'));
    store = new FileCandleStore(root);
    repos = new FakeBacktestRepositories();
    orders = new OrderService(repos, store);
    advancer = new AdvanceService(repos, store);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** Create the session once the tape is written (creation checks 1m coverage). */
  async function start() {
    const created = await makeSessionService(repos, store as never).create('alice', createBody());
    session = repos.rows.get(created.id)!.session;
  }
  const place = (over: Partial<PlaceOrderRequest>) =>
    orders.place('alice', session.id, { opId: randomUUID(), cursorMs: session.cursorMs, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1, ...over });
  const advance = (toCursorMs: number, opId = randomUUID()) => advancer.advance('alice', session.id, { opId, toCursorMs });
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'resolved',
      (e: { getStatus(): number; getResponse(): unknown }) => `${e.getStatus()} ${(e.getResponse() as { error?: { code: string } }).error?.code ?? ''}`.trim(),
    );

  it('a limit fills in one span and is stopped in a later span', async () => {
    await tape(store, BTC, C - 10 * MIN, 40, { 5: [100, 100, 99.4, 99.8], 20: [99.8, 99.8, 98.9, 99] });
    await tape(store, ETH, C - 10 * MIN, 40);
    await start();
    const limit = (await place({ type: 'limit', limitPrice: 99.5, sl: 99, tp: 102 })).order; // qty 100 / 0.5 = 200

    const first = await advance(C + 15 * MIN);
    expect(first.events).toEqual([{ orderId: limit.id, kind: 'fill', time: C + 5 * MIN, price: 99.5, resolution: '1m' }]);
    expect(first.orders).toEqual([expect.objectContaining({ id: limit.id, status: 'open', entryPrice: 99.5, entryTimeMs: C + 5 * MIN, fillResolution: '1m' })]);
    expect(first).toMatchObject({ cursorMs: C + 15 * MIN, status: 'active', balance: 10_000 });

    const second = await advance(C + 30 * MIN);
    // stop 99 - 0.25 = 98.75; gross (98.75 - 99.5) * 200 = -150; commission 7.96 + 7.9 = 15.86 → -165.86
    // MAE (limit: the fill candle counts): lows from C+5..C+20, worst 98.9 → 0.6 → 0.6 * 200 / 100 = 1.2R
    expect(second.events).toEqual([{ orderId: limit.id, kind: 'exit', time: C + 20 * MIN, price: 98.75, reason: 'stop', resolution: '1m' }]);
    const closed = second.orders[0];
    expect(closed).toMatchObject({ status: 'closed', closeReason: 'stop', exitPrice: 98.75, slTpSameBar: false, spreadCostCcy: 50 });
    expect(closed.pnlCcy).toBeCloseTo(-165.86, 8);
    expect(closed.pnlR).toBeCloseTo(-1.6586, 6);
    expect(closed.maePrice).toBeCloseTo(0.6, 8);
    expect(closed.maeR).toBeCloseTo(1.2, 6);
    expect(second.balance).toBeCloseTo(9834.14, 8);
    expect(second.stats).toMatchObject({ trades: 1, losses: 1 });
    const { statsComputedAt: _t, ...aggregates } = toSessionAggregates(second.stats, null);
    expect(repos.rows.get(session.id)!.session).toMatchObject({ ...aggregates, balance: second.balance, cursorMs: C + 30 * MIN });
  });

  it("SL and TP inside one candle resolve stop-first; the market order's entry candle is not in the span", async () => {
    // C-1 is the entry candle of a market order placed at C: its 98 low would stop it if it were walked.
    await tape(store, BTC, C - 10 * MIN, 30, { [-1]: [100, 100.2, 98, 100], 3: [100, 101.2, 98.8, 100] });
    await tape(store, ETH, C - 10 * MIN, 30);
    await start();
    const long = (await place({ sl: 99, tp: 101 })).order; // entry 100.25, qty 100

    const res = await advance(C + 15 * MIN);

    expect(res.events).toEqual([{ orderId: long.id, kind: 'exit', time: C + 3 * MIN, price: 98.75, reason: 'stop', resolution: '1m' }]);
    expect(res.orders[0]).toMatchObject({ closeReason: 'stop', slTpSameBar: true, exitTimeMs: C + 3 * MIN });
  });

  it('gap-through: a candle opening beyond the stop exits at its open, plus the half-spread', async () => {
    await tape(store, BTC, C - 10 * MIN, 30, { 2: [101.5, 102, 101.3, 101.8] });
    await tape(store, ETH, C - 10 * MIN, 30);
    await start();
    const short = (await place({ side: 'short', sl: 101, tp: 97 })).order; // entry 99.75

    const res = await advance(C + 15 * MIN);

    expect(res.events[0]).toMatchObject({ orderId: short.id, kind: 'exit', time: C + 2 * MIN, price: 101.75, reason: 'stop' });
  });

  it('pessimistic fallback: no 1m in the span → closed session-tf bars, flagged pessimistic-bar', async () => {
    await tape(store, BTC, C - 10 * MIN, 60);
    // ETH 1m: C-10..C-1, then nothing until C+2h (so coverage still intersects the period) —
    // the span C..C+40 has no ETH 1m at all
    await tape(store, ETH, C - 10 * MIN, 10);
    await tape(store, ETH, C + 120 * MIN, 1);
    await store.upsert([
      bar(ETH, '15m', C, [100, 100.2, 99.6, 100]),
      bar(ETH, '15m', C + 15 * MIN, [100, 102.5, 99.8, 102]),
      bar(ETH, '15m', C + 30 * MIN, [102, 110, 90, 100]), // forming at C+40: must not be walked
    ]);
    await start();
    const eth = (await place({ panelId: 'eth', sl: 99, tp: 102 })).order; // entry 100.25 at the C-1 1m close

    const res = await advance(C + 40 * MIN);

    // bar 1 touches nothing; bar 2 reaches the 102 target
    expect(res.events).toEqual([{ orderId: eth.id, kind: 'exit', time: C + 15 * MIN, price: 102, reason: 'take-profit', resolution: 'pessimistic-bar' }]);
    // MAE from those bars: 100.25 - 99.6 = 0.65 → 0.65R
    expect(res.orders[0]).toMatchObject({ status: 'closed', fillResolution: 'pessimistic-bar', closeReason: 'take-profit' });
    expect(res.orders[0].maePrice).toBeCloseTo(0.65, 8);
    expect(res.stats.pessimisticTrades).toBe(1);
  });

  it('a coalesced multi-bar span with two exits on two instruments applies them in exit-time order', async () => {
    await tape(store, BTC, C - 10 * MIN, 70, { 40: [100.5, 101.1, 100.4, 101] });
    await tape(store, ETH, C - 10 * MIN, 70, { 20: [99.5, 99.6, 98.9, 99.1] });
    await start();
    const btc = (await place({ sl: 99, tp: 101 })).order; // seq 1, entry 100.25
    const eth = (await place({ panelId: 'eth', side: 'short', sl: 101, tp: 99 })).order; // seq 2, entry 99.75

    const res = await advance(C + 60 * MIN);

    // ETH exits first (C+20) although it has the higher seq; BTC at C+40.
    // ETH: (99.75 - 99) * 100 = 75 - (3.99 + 3.96) = 67.05; BTC: (101 - 100.25) * 100 = 75 - (4.01 + 4.04) = 66.95
    expect(res.events.map((e) => [e.orderId, e.time])).toEqual([[eth.id, C + 20 * MIN], [btc.id, C + 40 * MIN]]);
    expect(res.orders.map((o) => o.seq)).toEqual([1, 2]);
    expect(res.balance).toBeCloseTo(10_134, 8);
    expect(res.stats.equityCurve.map((p) => [p.time, Number(p.balance.toFixed(8))])).toEqual([
      [C, 10_000],
      [C + 20 * MIN, 10_067.05],
      [C + 40 * MIN, 10_134],
    ]);
  });

  it('end of session: force-closes open positions at the last revealed 1m, cancels pending, completes', async () => {
    await tape(store, BTC, C - 10 * MIN, 70);
    await tape(store, ETH, C - 10 * MIN, 70);
    await start();
    const long = (await place({ sl: 99 })).order; // entry 100.25
    const pending = (await place({ type: 'limit', limitPrice: 95, sl: 94 })).order;

    // past period_to_ms: clamped. The tape ends at C+59, days before the period end.
    const res = await advance(PERIOD_TO + DAY);

    // exit at the last 1m close 100 - 0.25 = 99.75; (99.75 - 100.25) * 100 = -50 - (4.01 + 3.99) = -58
    expect(res).toMatchObject({ cursorMs: PERIOD_TO, status: 'complete' });
    expect(res.events).toEqual([{ orderId: long.id, kind: 'exit', time: C + 59 * MIN, price: 99.75, reason: 'end-of-session', resolution: '1m' }]);
    expect(res.orders.map((o) => [o.id, o.status, o.closeReason, o.cancelledAtMs])).toEqual([
      [long.id, 'closed', 'end-of-session', null],
      [pending.id, 'cancelled', null, PERIOD_TO],
    ]);
    expect(res.orders[0].pnlCcy).toBeCloseTo(-58, 8);
    expect(res.stats.endOfSessionCloses).toBe(1);
    expect(repos.rows.get(session.id)!.session).toMatchObject({ status: 'complete', cursorMs: PERIOD_TO, completedAt: expect.any(Number) });
    await expect(code(advance(PERIOD_TO))).resolves.toBe('409 SESSION_COMPLETE');
  });

  it('a replayed opId returns the stored body and moves nothing', async () => {
    await tape(store, BTC, C - 10 * MIN, 40, { 5: [100, 100, 99.4, 99.8] });
    await tape(store, ETH, C - 10 * MIN, 40);
    await start();
    await place({ type: 'limit', limitPrice: 99.5 });
    const opId = randomUUID();

    const first = await advance(C + 15 * MIN, opId);
    const fill = jest.spyOn(repos.orders, 'fill');
    const replay = await advance(C + 15 * MIN, opId); // the same request again (a retry)

    expect(replay).toEqual(first);
    expect(fill).not.toHaveBeenCalled();
    expect(repos.rows.get(session.id)!.session.cursorMs).toBe(C + 15 * MIN);
  });

  it('BUG-004: the same opId for a different target, or for a place, is 409 and moves nothing', async () => {
    await tape(store, BTC, C - 10 * MIN, 40);
    await tape(store, ETH, C - 10 * MIN, 40);
    await start();
    const opId = randomUUID();
    await advance(C + 15 * MIN, opId);

    await expect(code(advance(C + 30 * MIN, opId))).resolves.toBe('409'); // same kind, different body
    expect(repos.rows.get(session.id)!.session.cursorMs).toBe(C + 15 * MIN);

    // an opId first used by a place, then sent with an advance
    const placeOp = randomUUID();
    await orders.place('alice', session.id, { opId: placeOp, cursorMs: C + 15 * MIN, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1 });
    const err = await advance(C + 30 * MIN, placeOp).catch((e: { getStatus(): number; getResponse(): unknown }) => e);
    expect((err as { getStatus(): number }).getStatus()).toBe(409);
    expect((err as { getResponse(): { message: string } }).getResponse().message).toBe('opId already used for a different request');
    expect(repos.rows.get(session.id)!.session.cursorMs).toBe(C + 15 * MIN);
    expect(repos.opRows.size).toBe(2);
  });

  it('with no orders an advance only moves the cursor', async () => {
    await tape(store, BTC, C - 10 * MIN, 40);
    await tape(store, ETH, C - 10 * MIN, 40);
    await start();
    const before = { ...repos.rows.get(session.id)!.session };

    const res = await advance(C + 15 * MIN);

    expect(res).toEqual({ cursorMs: C + 15 * MIN, status: 'active', balance: 10_000, events: [], orders: [], stats: computeStats([], 10_000, C) });
    const after = repos.rows.get(session.id)!.session;
    expect({ ...after, cursorMs: before.cursorMs, updatedAt: before.updatedAt }).toEqual(before);
  });

  it('refusals: backwards 409, off-minute 400, equal cursor is a no-op, another user 404', async () => {
    await tape(store, BTC, C - 10 * MIN, 40);
    await tape(store, ETH, C - 10 * MIN, 40);
    await start();
    await advance(C + 15 * MIN);

    await expect(code(advance(C))).resolves.toBe('409 CURSOR_BACKWARDS');
    await expect(code(advance(C + 15 * MIN + 1))).resolves.toBe('400');
    await expect(advance(C + 15 * MIN)).resolves.toMatchObject({ cursorMs: C + 15 * MIN, events: [], orders: [] });
    await expect(code(advancer.advance('bob', session.id, { opId: randomUUID(), toCursorMs: C + 30 * MIN }))).resolves.toBe('404');
  });
});

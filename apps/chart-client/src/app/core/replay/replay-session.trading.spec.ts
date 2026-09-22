import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { FillEvent, Order, PlaceOrderRequest, Session, SessionDetail, SessionStats } from '@trade-automation/contracts';
import { ApiError } from '../api/api-error';
import { BacktestClient } from '../api/backtest.client';
import { NO_ACTIVE_TOOL_HINT, ReplaySessionStore } from './replay-session.store';
import { ScreenshotUploadQueue, type ScreenshotJob } from './screenshot-upload.queue';
import { CloseSoundSetting } from './close-sound.setting';

const M = 60_000;
const T0 = Date.UTC(2026, 8, 16, 10, 0);
const SESSION = {
  id: 's1', name: 'test', status: 'active', sessionCurrency: 'USD', timeframe: '5m', periodFromMs: T0, periodToMs: T0 + 60 * M,
  cursorMs: T0 + 5 * M, initialBalance: 10_000, balance: 10_000, defaultRiskPct: 1, skipWeekends: false,
  costs: { enabled: false, commissionPct: 0, spread: 0 },
  layout: { id: 'l', name: 'l', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
} as unknown as Session;
const STATS = { trades: 0 } as unknown as SessionStats;

function pending(req: PlaceOrderRequest): Order {
  return {
    id: '00000000-0000-4000-8000-0000000000b1', seq: 1, panelId: req.panelId, instrument: 'binance:BTCUSDT', side: req.side, type: req.type,
    status: 'pending', placedAtMs: req.cursorMs, limitPrice: req.limitPrice ?? null, entryPrice: null, entryTimeMs: null, qty: 1, riskPct: req.riskPct,
    riskAmountCcy: 100, slInitial: req.sl, slCurrent: req.sl, tpInitial: req.tp ?? null, tpCurrent: req.tp ?? null,
  } as unknown as Order;
}

/** A tape of 1m every minute (close 1.5); every mutation is recorded. */
function fakeClient() {
  const tuples = Array.from({ length: 60 }, (_, i) => [T0 + i * M, 1, 2, 0.5, 1.5, 1] as [number, number, number, number, number, number]);
  return {
    getSession: vi.fn(async (): Promise<SessionDetail> => ({ session: SESSION, openOrders: [], stats: STATS })),
    // the closed 5m bar behind the cursor (T0 + 5m): the panel's last close is 1.5
    getReplayHistory: vi.fn(async () => ({
      bars: [{ instrument: 'binance:BTCUSDT', timeframe: '5m', openTime: T0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5, closed: true, source: 'resampled' }],
      forming: null,
    })),
    getReplayAhead: vi.fn(async (_id: string, _p: string, fromMs: number) => ({ candles: tuples.filter((t) => t[0] >= fromMs), endOfTape: true })),
    patchSession: vi.fn(),
    listOrders: vi.fn(async (): Promise<Order[]> => []),
    getStats: vi.fn(async () => ({ computed: STATS, stored: {}, drift: false })),
    getInstruments: vi.fn(async () => [{ id: 'binance:BTCUSDT', pricePrecision: 2 }]),
    advance: vi.fn(),
    placeOrder: vi.fn(async (_id: string, body: PlaceOrderRequest) => ({ order: pending(body), events: [] })),
    cancelOrder: vi.fn(async (_id: string, orderId: string) => ({ ...pending({} as PlaceOrderRequest), id: orderId, status: 'cancelled' }) as Order),
    closeOrder: vi.fn(),
  };
}

async function open(client = fakeClient()) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [ReplaySessionStore, { provide: BacktestClient, useValue: client }] });
  const store = TestBed.inject(ReplaySessionStore);
  await store.open('s1');
  store.sources(); // builds the panel's tool store, as the grid does
  return { store, client };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

describe('ReplaySessionStore — the trading loop (T-023)', () => {
  it('Enter without an active draft never creates an order: a hint, and the transport sees no place', async () => {
    const { store, client } = await open();
    store.placeActiveDraft();
    await settle();
    expect(client.placeOrder).not.toHaveBeenCalled();
    expect(store.hint()).toBe(NO_ACTIVE_TOOL_HINT);
  });

  it('Enter on a draft sends exactly the PlaceOrderRequest; on 201 the draft is consumed into an active pending drawing', async () => {
    const { store, client } = await open();
    const tools = store.toolStore('btc');
    tools.pointerPrice.set(1.2); // below the last close 1.5 → a limit
    const draft = tools.create('long')!;
    store.placeActiveDraft();
    store.placeActiveDraft(); // a second Enter while it is on its way: not sent twice
    await settle();

    expect(client.placeOrder).toHaveBeenCalledTimes(1);
    expect(client.placeOrder.mock.calls[0][1]).toEqual({
      opId: expect.any(String), cursorMs: T0 + 5 * M, panelId: 'btc', side: 'long', type: 'limit',
      limitPrice: draft.entry, sl: draft.sl, tp: draft.tp, riskPct: 1,
    });
    expect(tools.tools()).toEqual([]); // consumed
    const drawn = store.sources().get('btc')!.positionTools!.view().tools;
    expect(drawn).toEqual([expect.objectContaining({ id: '00000000-0000-4000-8000-0000000000b1', kind: 'pending', mode: 'limit', entry: draft.entry, active: true })]);
    // anchored at the last bar at its placement (the 5m bar that closed at the cursor), with its own qty
    expect(drawn[0]).toMatchObject({ anchorTime: T0, order: { qty: 1, riskAmount: 100 } });
    expect(store.positions().rows.map((r) => r.order.status)).toEqual(['pending']);
  });

  it("the order panel's risk % goes into the request", async () => {
    const { store, client } = await open();
    store.riskPctOverride.set(0.5);
    store.toolStore('btc').create('long'); // market at the last close
    store.placeActiveDraft();
    await settle();
    expect(client.placeOrder.mock.calls[0][1]).toMatchObject({ type: 'market', riskPct: 0.5 });
    expect(client.placeOrder.mock.calls[0][1]).not.toHaveProperty('limitPrice');
  });

  it('a 422 on place is a hint: the draft stays and the session is not reloaded', async () => {
    const client = fakeClient();
    client.placeOrder.mockRejectedValueOnce(new ApiError(422, 'SL_ON_WRONG_SIDE', 'A long stop must be below the entry.'));
    const { store } = await open(client);
    store.toolStore('btc').create('long');
    store.placeActiveDraft();
    await settle();
    expect(store.hint()).toBe('Order refused: A long stop must be below the entry.');
    expect(store.toolStore('btc').tools()).toHaveLength(1);
    expect(client.getSession).toHaveBeenCalledTimes(1);
  });

  it('BUG-009: Enter while the session is reloading is a hint, not a silently dropped order', async () => {
    const { store, client } = await open();
    store.toolStore('btc').create('long');
    let release!: () => void;
    client.getSession.mockImplementationOnce(() => new Promise((r) => (release = () => r({ session: SESSION, openOrders: [], stats: STATS }))));
    const reload = store.open('s1'); // a refusal's reload, getSession held
    store.placeActiveDraft();
    expect(store.hint()).toBe('The session is reloading — press Enter again in a moment.');
    release();
    await reload;
    store.placeActiveDraft(); // the same draft, once the new queue is up
    await settle();
    expect(client.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('T-054: a size below the venue minimum is refused before sending, with the risk % it needs; the account is marked', async () => {
    const client = fakeClient();
    client.getInstruments.mockResolvedValue([
      { id: 'binance:BTCUSDT', pricePrecision: 2, contract: { unit: 'BTC', multiplier: 1, minQty: 1_000_000, qtyStep: 1, maxLeverage: 10 } },
    ] as never);
    const { store } = await open(client);
    expect(store.margin()).toEqual({ equity: 10_000, usedMargin: 0, available: 10_000 }); // nothing open yet
    expect(store.marginUtilisation()).toBe(0);
    store.toolStore('btc').create('long'); // a market draft at 1.5: 100 of risk sizes far below 1 000 000 BTC
    store.placeActiveDraft();
    await settle();
    expect(client.placeOrder).not.toHaveBeenCalled();
    expect(store.hint()).toMatch(/^Below the venue minimum: the smallest order is 1000000 BTC, which needs a risk of at least/);
  });

  it('a client-side check refuses before sending (the limit is no longer below the last close)', async () => {
    const { store, client } = await open();
    const tools = store.toolStore('btc');
    tools.pointerPrice.set(1.2);
    const draft = tools.create('long')!;
    tools.apply({ type: 'update', tool: { ...draft, entry: 1.6, sl: 1.55, tp: 1.7 }, final: true }); // above 1.5
    store.placeActiveDraft();
    await settle();
    expect(client.placeOrder).not.toHaveBeenCalled();
    expect(store.hint()).toMatch(/no longer below the last close/);
  });

  it('cancel goes through the queue to the transport', async () => {
    const { store, client } = await open();
    store.toolStore('btc').pointerPrice.set(1.2);
    store.toolStore('btc').create('long');
    store.placeActiveDraft();
    await settle();
    store.cancelOrder('00000000-0000-4000-8000-0000000000b1');
    await settle();
    expect(client.cancelOrder).toHaveBeenCalledWith('s1', '00000000-0000-4000-8000-0000000000b1', { opId: expect.any(String), cursorMs: T0 + 5 * M });
    expect(store.positions().rows).toEqual([]); // the cancelled row is no longer live
  });
});

describe('ReplaySessionStore — the trade screenshots (T-026, §9.2)', () => {
  const O1 = '00000000-0000-4000-8000-0000000000b1';
  const O2 = '00000000-0000-4000-8000-0000000000b2';

  /** The store with a recording upload queue and a chart that logs when its picture is taken. */
  async function openWithCamera(client = fakeClient()) {
    const log: string[] = [];
    const jobs: ScreenshotJob[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'], { type: 'image/png' })));
    const placeOrder = client.placeOrder.getMockImplementation()!;
    client.placeOrder.mockImplementation(async (id: string, body: PlaceOrderRequest) => {
      log.push('place request');
      return placeOrder(id, body);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ReplaySessionStore,
        { provide: BacktestClient, useValue: client },
        { provide: ScreenshotUploadQueue, useValue: { enqueue: (j: ScreenshotJob) => jobs.push(j) } },
      ],
    });
    const store = TestBed.inject(ReplaySessionStore);
    await store.open('s1');
    // what ChartPanelComponent does with its chart
    store.sources().get('btc')!.capture!.attach(() => {
      log.push('picture taken');
      return { width: 1600, height: 900 } as HTMLCanvasElement;
    });
    return { store, client, log, jobs };
  }

  const advanceWith = (events: FillEvent[], orders: Order[] = []) => ({
    cursorMs: T0 + 10 * M, status: 'active', balance: 10_000, events, orders, stats: STATS,
  });
  const exitEvent = (orderId: string, reason: 'stop' | 'take-profit'): FillEvent =>
    ({ orderId, kind: 'exit', time: T0 + 6 * M, price: 1, reason, resolution: '1m' }) as FillEvent;

  it('entry: the picture is taken in the Enter handler before the place request, and uploaded with the new order id', async () => {
    const { store, log, jobs } = await openWithCamera();
    store.toolStore('btc').create('long');
    store.placeActiveDraft();
    expect(log).toEqual(['picture taken', 'place request']); // both in the Enter handler: the picture first
    await settle();
    expect(jobs).toEqual([{ sessionId: 's1', orderId: O1, kind: 'entry', png: expect.any(Promise) }]);
    expect((await jobs[0].png).type).toBe('image/png');
  });

  it('a refused order (422) uploads nothing', async () => {
    const client = fakeClient();
    client.placeOrder.mockRejectedValueOnce(new ApiError(422, 'SL_ON_WRONG_SIDE', 'no'));
    const { store, jobs } = await openWithCamera(client);
    store.toolStore('btc').create('long');
    store.placeActiveDraft();
    await settle();
    expect(jobs).toEqual([]);
  });

  it('a coalesced advance answer with two exits uploads two exit pictures (decision 27)', async () => {
    const client = fakeClient();
    const rows = [O1, O2].map((id) => ({ ...pending({ panelId: 'btc' } as PlaceOrderRequest), id, status: 'closed' }) as Order);
    client.advance.mockResolvedValue(advanceWith([exitEvent(O1, 'stop'), exitEvent(O2, 'take-profit')], rows));
    const { store, jobs, log } = await openWithCamera(client);
    await store.engine()!.step(); // one step: one answer carrying both exits
    await vi.waitFor(() => expect(jobs).toHaveLength(2));
    expect(jobs.map((j) => [j.orderId, j.kind])).toEqual([
      [O1, 'exit'],
      [O2, 'exit'],
    ]);
    expect(log).toEqual(['picture taken', 'picture taken']);
  });

  it('a manual close uploads the exit picture (its answer carries no events)', async () => {
    const client = fakeClient();
    client.closeOrder.mockResolvedValue({ order: { ...pending({ panelId: 'btc' } as PlaceOrderRequest), status: 'closed', closeReason: 'manual' }, stats: STATS, balance: 9_990 });
    const { store, jobs } = await openWithCamera(client);
    store.closeOrder(O1);
    await vi.waitFor(() => expect(jobs.map((j) => [j.orderId, j.kind])).toEqual([[O1, 'exit']]));
  });
});

describe('ReplaySessionStore — moving a live stop or target (T-033)', () => {
  const OPEN: Order = {
    ...pending({ panelId: 'btc', side: 'long', type: 'market', cursorMs: T0, sl: 1, riskPct: 1 } as PlaceOrderRequest),
    id: '00000000-0000-4000-8000-0000000000c1', status: 'open', entryPrice: 1.4, entryTimeMs: T0, qty: 100, riskAmountCcy: 40, tpCurrent: 3, tpInitial: 3,
  } as Order;

  async function withPosition() {
    const client = { ...fakeClient(), listOrders: vi.fn(async () => [OPEN]), modifyOrder: vi.fn() };
    const { store } = await open(client);
    const tools = store.sources().get('btc')!.positionTools!;
    const drawn = () => tools.view().tools.find((t) => t.orderId === OPEN.id)!;
    const drop = (sl: number, final = true) => tools.apply({ type: 'update', tool: { ...drawn(), sl }, final });
    return { store, client, tools, drawn, drop };
  }

  it('a dropped stop (break-even) is one modify with only that level; the drawing holds, then shows the server value; open risk follows', async () => {
    const { store, client, drawn, drop } = await withPosition();
    expect(store.positions().openRisk).toBeCloseTo(40, 9); // (1.4 - 1.0) * 100
    let answer!: (o: Order) => void;
    client.modifyOrder.mockImplementation(() => new Promise<Order>((r) => (answer = r)));

    drop(1.2, false); // dragging: the drawing follows, nothing is sent
    expect(drawn().sl).toBe(1.2);
    drop(1.4); // the drop, at break-even
    await settle();
    expect(client.modifyOrder).toHaveBeenCalledTimes(1);
    expect(client.modifyOrder.mock.calls[0][1]).toEqual(OPEN.id);
    expect(client.modifyOrder.mock.calls[0][2]).toEqual({ opId: expect.any(String), cursorMs: T0 + 5 * M, sl: 1.4, tp: undefined });
    expect(drawn().sl).toBe(1.4); // held while the request is in flight

    answer({ ...OPEN, slCurrent: 1.4 });
    await settle();
    expect(drawn().sl).toBe(1.4); // now the server's own value
    expect(store.portfolio.orders().find((o) => o.id === OPEN.id)?.slCurrent).toBe(1.4);
    expect(store.positions().openRisk).toBe(0); // a stop at the entry risks nothing
  });

  it('a drop into the market is a hint and no request; the drawing snaps back', async () => {
    const { store, client, drawn, drop } = await withPosition();
    drop(1.6); // above the last close 1.5
    await settle();
    expect(client.modifyOrder).not.toHaveBeenCalled();
    expect(store.hint()).toBe('A long stop must stay below the last close.');
    expect(drawn().sl).toBe(1);
  });

  it('a 422 from the server snaps the drawing back with a hint; nothing is reloaded', async () => {
    const { store, client, drawn, drop } = await withPosition();
    client.modifyOrder.mockRejectedValueOnce(new ApiError(422, 'SL_ON_WRONG_SIDE', 'A long stop must be below the last close, a short stop above it.'));
    drop(1.3);
    await settle();
    expect(store.hint()).toBe('Move refused: A long stop must be below the last close, a short stop above it.');
    expect(drawn().sl).toBe(1);
    expect(client.getSession).toHaveBeenCalledTimes(1);
  });
});

describe('ReplaySessionStore — trade-close notices (T-051)', () => {
  const O1 = '00000000-0000-4000-8000-0000000000c1';
  const O2 = '00000000-0000-4000-8000-0000000000c2';
  const closedRow = (id: string, reason: 'stop' | 'take-profit' | 'manual', pnl: number) =>
    ({ ...pending({ panelId: 'btc' } as PlaceOrderRequest), id, status: 'closed', closeReason: reason, pnlCcy: pnl, pnlR: pnl / 100 }) as Order;
  const exitEvent = (orderId: string): FillEvent => ({ orderId, kind: 'exit', time: T0 + 6 * M, price: 1, reason: 'stop', resolution: '1m' }) as FillEvent;

  async function openWithSound(client = fakeClient(), on = true) {
    const played: number[] = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ReplaySessionStore,
        { provide: BacktestClient, useValue: client },
        { provide: CloseSoundSetting, useValue: { on: () => on, play: () => on && played.push(1), arm: () => undefined } }, // muting is the setting's (its own spec)
      ],
    });
    const store = TestBed.inject(ReplaySessionStore);
    await store.open('s1');
    return { store, client, played };
  }

  it('an advance answer closing two trades: two notices, one sound', async () => {
    const client = fakeClient();
    client.advance.mockResolvedValue({ cursorMs: T0 + 10 * M, status: 'active', balance: 10_100, events: [exitEvent(O1), exitEvent(O2)], orders: [closedRow(O1, 'stop', -100), closedRow(O2, 'take-profit', 200)], stats: STATS });
    const { store, played } = await openWithSound(client);
    await store.engine()!.step();
    await vi.waitFor(() => expect(store.closeNotices.notices()).toHaveLength(2));
    expect(store.closeNotices.notices().map((n) => [n.reason, n.pnlCcy])).toEqual([['stop', -100], ['take-profit', 200]]);
    expect(played).toEqual([1]);
  });

  it('trades already closed when the session loads are history: never announced', async () => {
    const client = fakeClient();
    client.listOrders.mockResolvedValue([closedRow(O1, 'stop', -100)]);
    client.advance.mockResolvedValue({ cursorMs: T0 + 10 * M, status: 'active', balance: 10_000, events: [exitEvent(O1)], orders: [closedRow(O1, 'stop', -100)], stats: STATS });
    const { store, played } = await openWithSound(client);
    expect(store.closeNotices.notices()).toEqual([]);
    await store.engine()!.step(); // even if a row of it came back again
    await new Promise((r) => setTimeout(r, 0));
    expect(store.closeNotices.notices()).toEqual([]);
    expect(played).toEqual([]);
  });

  it('a manual close is announced; muted, it makes no sound', async () => {
    const client = fakeClient();
    client.closeOrder.mockResolvedValue({ order: closedRow(O1, 'manual', 12), stats: STATS, balance: 10_012 });
    const { store, played } = await openWithSound(client, false);
    store.closeOrder(O1);
    await vi.waitFor(() => expect(store.closeNotices.notices().map((n) => n.reason)).toEqual(['manual']));
    expect(played).toEqual([]);
  });
});

describe('ReplaySessionStore — removing a live order’s tool (BUG-017)', () => {
  const O1 = '00000000-0000-4000-8000-0000000000d1';
  const row = (status: 'pending' | 'open' | 'closed') => ({ ...pending({ panelId: 'btc' } as PlaceOrderRequest), id: O1, seq: 7, status }) as Order;

  it('a pending order: Delete → "Cancel order #7?" → confirm sends the cancel through the queue', async () => {
    const client = fakeClient();
    client.listOrders.mockResolvedValue([row('pending')]);
    const { store } = await open(client);
    store.requestRemove(O1);
    expect(store.removeRequest()).toMatchObject({ action: 'cancel', question: 'Cancel order #7?' });
    expect(client.cancelOrder).not.toHaveBeenCalled(); // nothing before the confirm
    store.confirmRemove();
    await vi.waitFor(() => expect(client.cancelOrder).toHaveBeenCalledWith('s1', O1, expect.objectContaining({ opId: expect.any(String) })));
    expect(store.removeRequest()).toBeNull();
  });

  it('an open position: "Close position #7 at market?" → confirm sends the close; keep sends nothing', async () => {
    const client = fakeClient();
    client.listOrders.mockResolvedValue([row('open')]);
    client.closeOrder.mockResolvedValue({ order: { ...row('closed'), closeReason: 'manual' }, stats: STATS, balance: 10_000 });
    const { store } = await open(client);
    store.requestRemove(O1);
    expect(store.removeRequest()).toMatchObject({ action: 'close', question: 'Close position #7 at market?' });
    store.dismissRemove();
    await settle();
    expect(client.closeOrder).not.toHaveBeenCalled();
    store.requestRemove(O1);
    store.confirmRemove();
    await vi.waitFor(() => expect(client.closeOrder).toHaveBeenCalledTimes(1));
  });

  it('an order that is already over asks nothing', async () => {
    const client = fakeClient();
    client.listOrders.mockResolvedValue([row('closed')]);
    const { store } = await open(client);
    store.requestRemove(O1);
    expect(store.removeRequest()).toBeNull();
  });
});

describe('ReplaySessionStore — live tools’ right edge and the confirm-time re-check (BUG-018)', () => {
  const O1 = '00000000-0000-4000-8000-0000000000e1';
  const row = (status: 'pending' | 'open' | 'closed') => ({ ...pending({ panelId: 'btc', cursorMs: T0 + 5 * M } as PlaceOrderRequest), id: O1, seq: 7, status }) as Order;

  it('a pending order’s tool ends at the newest bar (the cursor’s), so it grows with each step', async () => {
    const client = fakeClient();
    client.listOrders.mockResolvedValue([row('pending')]);
    const { store } = await open(client);
    const drawn = store.sources().get('btc')!.positionTools!.view().tools.find((t) => t.id === O1)!;
    expect(drawn.endTime).toBe(T0); // the 5m bar at the cursor (T0 + 5m) opens at T0
  });

  it('the order closed by itself before the confirm (Play): a hint, and nothing is sent', async () => {
    const client = fakeClient();
    client.listOrders.mockResolvedValue([row('open')]);
    const { store } = await open(client);
    store.requestRemove(O1);
    store.portfolio.setOrders([{ ...row('closed'), closeReason: 'stop' }]); // the stop hit meanwhile
    store.confirmRemove();
    await settle();
    expect(client.closeOrder).not.toHaveBeenCalled();
    expect(store.hint()).toBe('Order #7 is already closed.');
  });

  it('a pending order that filled before the confirm: asked again, as the position it now is', async () => {
    const client = fakeClient();
    client.listOrders.mockResolvedValue([row('pending')]);
    const { store } = await open(client);
    store.requestRemove(O1);
    store.portfolio.setOrders([row('open')]);
    store.confirmRemove();
    await settle();
    expect(client.cancelOrder).not.toHaveBeenCalled();
    expect(store.removeRequest()).toMatchObject({ action: 'close', question: 'Close position #7 at market?' });
  });
});

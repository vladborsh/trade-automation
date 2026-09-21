import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Order, PlaceOrderRequest, Session, SessionDetail, SessionStats } from '@trade-automation/contracts';
import { ApiError } from '../api/api-error';
import { BacktestClient } from '../api/backtest.client';
import { NO_ACTIVE_TOOL_HINT, ReplaySessionStore } from './replay-session.store';

const M = 60_000;
const T0 = Date.UTC(2026, 8, 16, 10, 0);
const SESSION = {
  id: 's1', name: 'test', status: 'active', sessionCurrency: 'USD', timeframe: '5m', periodFromMs: T0, periodToMs: T0 + 60 * M,
  cursorMs: T0 + 5 * M, initialBalance: 10_000, balance: 10_000, defaultRiskPct: 1, skipWeekends: false, notionalWarnMultiple: 5,
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

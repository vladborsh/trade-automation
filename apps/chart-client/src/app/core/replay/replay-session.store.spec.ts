import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { AdvanceResult, Order, Session, SessionDetail, SessionStats } from '@trade-automation/contracts';
import { ApiError } from '../api/api-error';
import { BacktestClient } from '../api/backtest.client';
import { ReplaySessionStore, VALUE_LIMIT_NOTICE } from './replay-session.store';

const M = 60_000;
const T0 = Date.UTC(2026, 8, 16, 10, 0); // a Wednesday

const SESSION = {
  id: 's1', name: 'test', status: 'active', sessionCurrency: 'USD', timeframe: '5m',
  periodFromMs: T0, periodToMs: T0 + 30 * M, cursorMs: T0, initialBalance: 10_000, balance: 10_000, skipWeekends: true,
  layout: { id: 'l', name: 'l', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
} as unknown as Session;
const STATS = { trades: 0 } as unknown as SessionStats;

/** A tape of 1m every minute of the period; history empty (the session starts at its first bar). */
function fakeClient(session: Session = SESSION) {
  const tuples = Array.from({ length: 30 }, (_, i) => [T0 + i * M, 1, 2, 0.5, 1.5, 1] as [number, number, number, number, number, number]);
  return {
    getSession: vi.fn(async (): Promise<SessionDetail> => ({ session, openOrders: [], stats: STATS })),
    getReplayHistory: vi.fn(async () => ({ bars: [], forming: null })),
    getReplayAhead: vi.fn(async (_id: string, _p: string, fromMs: number) => ({ candles: tuples.filter((t) => t[0] >= fromMs), endOfTape: true })),
    patchSession: vi.fn(),
    listOrders: vi.fn(async (): Promise<Order[]> => [{ id: 'o0', seq: 1, status: 'closed' } as Order]),
    getStats: vi.fn(async () => ({ computed: STATS, stored: {}, drift: false })),
    getInstruments: vi.fn(async () => [{ id: 'binance:BTCUSDT', pricePrecision: 2 }]),
    advance: vi.fn(async (_id: string, body: { toCursorMs: number }): Promise<AdvanceResult> => ({
      cursorMs: body.toCursorMs,
      status: body.toCursorMs >= session.periodToMs ? 'complete' : 'active',
      balance: 10_250,
      events: [],
      orders: [{ id: 'o1', seq: 1, status: 'open' } as Order],
      stats: { trades: 1 } as unknown as SessionStats,
    })),
  };
}

async function open(client: ReturnType<typeof fakeClient>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [ReplaySessionStore, { provide: BacktestClient, useValue: client }] });
  const store = TestBed.inject(ReplaySessionStore);
  await store.open('s1');
  return store;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('ReplaySessionStore (T-021)', () => {
  it('persists every step and reconciles the response: server cursor, balance, orders, stats', async () => {
    const client = fakeClient();
    const store = await open(client);
    await store.engine()!.step();
    await settle();

    expect(client.advance).toHaveBeenCalledWith('s1', expect.objectContaining({ toCursorMs: T0 + 5 * M }));
    expect(store.session()).toMatchObject({ cursorMs: T0 + 5 * M, balance: 10_250, status: 'active' });
    expect(store.portfolio.orders().map((o) => o.id)).toEqual(['o0', 'o1']); // o1 added by the advance
    expect(store.portfolio.stats()).toEqual({ trades: 0 }); // then GET …/stats on idle is the truth
    expect(store.pendingMutations).toBe(0);
  });

  it('loads the journal (every order), the stats with drift, and the price precision', async () => {
    const client = fakeClient();
    client.getStats.mockResolvedValueOnce({ computed: { trades: 7 } as unknown as SessionStats, stored: {}, drift: true });
    const store = await open(client);
    expect(store.portfolio.orders().map((o) => o.id)).toEqual(['o0']);
    expect(store.portfolio.stats()).toEqual({ trades: 7 });
    expect(store.portfolio.drift()).toBe(true);
    expect(store.pricePrecision().get('binance:BTCUSDT')).toBe(2);
  });

  it('refreshes the stats once the queue has drained, not per response', async () => {
    const client = fakeClient();
    const answer = client.advance.getMockImplementation()!;
    client.advance.mockImplementation(async (id, body) => {
      await new Promise((r) => setTimeout(r, 20)); // a slow server: the second step queues behind the first
      return answer(id, body);
    });
    const store = await open(client);
    expect(client.getStats).toHaveBeenCalledTimes(1); // on open
    await store.engine()!.step();
    await store.engine()!.step();
    // until the queue has drained, not a fixed sleep (a loaded machine overran 80 ms)
    await vi.waitFor(
      () => {
        expect(client.advance).toHaveBeenCalledTimes(2);
        expect(store.pendingMutations).toBe(0);
        expect(client.getStats).toHaveBeenCalledTimes(2);
      },
      { timeout: 5_000 },
    );
    await settle();
    expect(client.getStats).toHaveBeenCalledTimes(2); // one refresh for the drained queue, not one per response
  });

  it('locks the workspace when a response says complete', async () => {
    const client = fakeClient();
    const store = await open(client);
    for (let i = 0; i < 6; i++) await store.engine()!.step(); // to the period end
    await settle();
    expect(store.session()?.status).toBe('complete');
    expect(store.engine()!.completed()).toBe(true);
  });

  it('opens a complete session locked', async () => {
    const store = await open(fakeClient({ ...SESSION, status: 'complete', cursorMs: SESSION.periodToMs }));
    expect(store.engine()!.completed()).toBe(true);
  });

  it('409 CURSOR_MISMATCH (a second tab): notice, and the session is reloaded from the server', async () => {
    const client = fakeClient();
    client.advance.mockRejectedValueOnce(new ApiError(409, 'CURSOR_BACKWARDS', 'toCursorMs is before the cursor'));
    const store = await open(client);
    const first = store.engine();
    client.getSession.mockResolvedValueOnce({ session: { ...SESSION, cursorMs: T0 + 20 * M }, openOrders: [], stats: STATS });

    await first!.step();
    await settle();
    await settle();

    expect(client.getSession).toHaveBeenCalledTimes(2);
    expect(store.notice()).toMatch(/another tab/);
    expect(store.engine()).not.toBe(first); // a fresh engine…
    expect(store.engine()!.cursor()).toBe(T0 + 20 * M); // …at the server's cursor
  });

  it('T-059: 422 VALUE_OUT_OF_RANGE is terminal — no retry, no reload loop; a persistent notice; stepping and placing are off', async () => {
    const client = fakeClient();
    client.advance.mockRejectedValue(new ApiError(422, 'VALUE_OUT_OF_RANGE', 'values must stay below 1e12'));
    const store = await open(client);
    const engine = store.engine()!;

    await engine.step();
    await settle();
    await new Promise((r) => setTimeout(r, 300)); // past the first retry backoff (250 ms): nothing is resent

    expect(client.advance).toHaveBeenCalledTimes(1); // no retry
    expect(client.getSession).toHaveBeenCalledTimes(1); // no reload (it would only fail again)
    expect(store.engine()).toBe(engine);
    expect(store.halted()).toBe(VALUE_LIMIT_NOTICE);
    expect(store.halted()).toBe('This session has reached the numeric limit; create a new session');
    expect(engine.halted()).toBe(true);
    expect(store.notice()).toBeNull(); // not the reload notice

    const cursor = engine.cursor();
    await engine.step(); // inert
    store.createDraft('long'); // refused with the notice as a hint
    store.placeActiveDraft();
    store.closeOrder('o0');
    await settle();
    expect(engine.cursor()).toBe(cursor);
    expect(store.activeTool()).toBeNull();
    expect(store.hint()).toBe(VALUE_LIMIT_NOTICE);
    expect(client.advance).toHaveBeenCalledTimes(1);
    expect(client.getSession).toHaveBeenCalledTimes(1);

    await store.open('s1'); // opening the session again starts clean (the server decides again)
    expect(store.halted()).toBeNull();
    expect(store.engine()!.halted()).toBe(false);
  });

  it('BUG-009: while the reload is loading, the old engine shows loading and a step is ignored, not lost', async () => {
    const client = fakeClient();
    client.advance.mockRejectedValueOnce(new ApiError(409, 'CURSOR_BACKWARDS', 'toCursorMs is before the cursor'));
    const store = await open(client);
    const first = store.engine()!;
    let release!: () => void;
    const detail: SessionDetail = { session: { ...SESSION, cursorMs: T0 + 20 * M }, openOrders: [], stats: STATS };
    client.getSession.mockImplementationOnce(() => new Promise((r) => (release = () => r(detail))));

    await first.step(); // refused → reload starts, getSession held
    await settle();
    expect(store.engine()).toBe(first); // still on screen…
    expect(first.blocked()).toBe(true); // …but showing "loading"
    expect(first.started()).toBe(false); // …and not "started" (the e2e readiness hook)
    const cursor = first.cursor();
    await first.step(); // the key pressed during the reload
    expect(first.cursor()).toBe(cursor); // not moved on screen only to vanish

    release();
    await settle();
    await settle();
    expect(store.engine()).not.toBe(first);
    expect(store.engine()!.blocked()).toBe(false);
    expect(store.engine()!.started()).toBe(true);
    expect(client.advance).toHaveBeenCalledTimes(1); // only the refused one
  });

  it('T-036: an advance answer keeps the panel sources (no chart rebuild); a layout change replaces them', async () => {
    const client = fakeClient();
    const store = await open(client);
    const before = store.sources().get('btc');
    await store.engine()!.step();
    await settle();
    expect(store.session()?.cursorMs).toBe(T0 + 5 * M); // the answer landed and updated the session…
    expect(store.sources().get('btc')).toBe(before); // …and the chart's source is the same object

    store.session.update((s) => (s ? { ...s, layout: { ...s.layout, panels: [...s.layout.panels] } } : s));
    expect(store.sources().get('btc')).not.toBe(before);
  });

  it('shows "retrying" while a network failure is being retried', async () => {
    const client = fakeClient();
    let fail = true;
    const real = client.advance.getMockImplementation()!;
    client.advance.mockImplementation(async (id, body) => {
      if (fail) throw new TypeError('Failed to fetch');
      return real(id, body);
    });
    const store = await open(client);
    await store.engine()!.step();
    await settle();
    expect(store.retrying()).toBe(true);
    fail = false;
    // after the first backoff (250 ms); waited for, not slept past
    await vi.waitFor(
      () => {
        expect(store.retrying()).toBe(false);
        expect(store.session()?.cursorMs).toBe(T0 + 5 * M);
      },
      { timeout: 5_000 },
    );
  });

  it('GUARD (§9.3): view-only never sends a mutating request, and a normal open resumes at the persisted cursor', async () => {
    const persisted = { ...SESSION, cursorMs: T0 + 25 * M };
    const client = fakeClient(persisted);
    const calls: string[] = [];
    const recorded = new Proxy(client, {
      get: (target, prop: string) => {
        const value = (target as Record<string, unknown>)[prop];
        return typeof value === 'function' ? (...args: unknown[]) => (calls.push(prop), (value as (...a: unknown[]) => unknown)(...args)) : value;
      },
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ReplaySessionStore, { provide: BacktestClient, useValue: recorded }] });
    const store = TestBed.inject(ReplaySessionStore);

    await store.open('s1', { viewAt: T0 + 5 * M, orderId: 'o0' });
    const view = store.engine()!;
    expect(view.viewOnly).toBe(true);
    expect(view.cursor()).toBe(T0 + 5 * M);
    await view.step(); // → is inert
    await view.setTimeframe('1h'); // allowed, not persisted
    expect(view.timeframe()).toBe('1h');
    store.ngOnDestroy(); // leaving the view
    await settle();

    const mutating = ['advance', 'placeOrder', 'cancelOrder', 'closeOrder', 'modifyOrder', 'patchSession', 'deleteSession', 'createSession'];
    expect(calls.filter((c) => mutating.includes(c))).toEqual([]);
    expect(calls).not.toContain('getReplayAhead'); // and no ahead cache
    expect(store.pendingMutations).toBe(0);

    await store.open('s1'); // back to the workspace
    expect(store.engine()!.viewOnly).toBe(false);
    expect(store.engine()!.cursor()).toBe(T0 + 25 * M); // the persisted cursor, not viewAt
  });

  it('view-only shows the order as a read-only position tool on its panel; a drag changes nothing', async () => {
    const client = fakeClient();
    client.listOrders.mockResolvedValueOnce([
      { id: 'o0', seq: 1, status: 'closed', panelId: 'btc', side: 'long', type: 'market', entryTimeMs: T0, placedAtMs: T0 + M, entryPrice: 1.5, limitPrice: null, slCurrent: 1, tpCurrent: 2, exitPrice: 2, qty: 20, riskAmountCcy: 10 } as Order,
    ]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ReplaySessionStore, { provide: BacktestClient, useValue: client }] });
    const store = TestBed.inject(ReplaySessionStore);
    await store.open('s1', { viewAt: T0 + M, orderId: 'o0' });

    const tools = store.sources().get('btc')!.positionTools!;
    expect(tools.view().tools).toEqual([
      { id: 'view-o0', orderId: 'o0', side: 'long', mode: 'market', entry: 1.5, sl: 1, tp: 2, kind: 'position', active: false, anchorTime: T0, order: { qty: 20, riskAmount: 10 }, readOnly: true },
    ]);
    const tool = tools.view().tools[0];
    tools.apply({ type: 'update', tool: { ...tool, sl: 0.5 }, final: true });
    tools.apply({ type: 'activate', id: tool.id });
    expect(tools.view().tools[0]).toEqual(tool);

    await store.open('s1'); // the normal workspace gets T-022's editable tools back
    expect(store.sources().get('btc')!.positionTools!.view().tools).toEqual([]);
  });
});

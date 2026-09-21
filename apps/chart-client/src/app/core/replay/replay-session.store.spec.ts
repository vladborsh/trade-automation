import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { AdvanceResult, Order, Session, SessionDetail, SessionStats } from '@trade-automation/contracts';
import { ApiError } from '../api/api-error';
import { BacktestClient } from '../api/backtest.client';
import { ReplaySessionStore } from './replay-session.store';

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
    await new Promise((r) => setTimeout(r, 80));
    expect(client.advance).toHaveBeenCalledTimes(2);
    expect(client.getStats).toHaveBeenCalledTimes(2); // one refresh for the drained queue
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
    await new Promise((r) => setTimeout(r, 300)); // first backoff is 250 ms
    expect(store.retrying()).toBe(false);
    expect(store.session()?.cursorMs).toBe(T0 + 5 * M);
  });
});

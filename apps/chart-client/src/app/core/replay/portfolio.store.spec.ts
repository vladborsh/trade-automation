import type { FillEvent, Order, SessionDetail, SessionStats } from '@trade-automation/contracts';
import { PortfolioStore } from './portfolio.store';

const order = (id: string, seq: number, extra: Partial<Order> = {}) =>
  ({ id, seq, status: 'pending', entryPrice: null, entryTimeMs: null, exitPrice: null, exitTimeMs: null, closeReason: null, fillResolution: null, qty: 1, contractMultiplier: 1, pnlCcy: null, pnlR: null, ...extra }) as Order;
const stats = { trades: 0 } as unknown as SessionStats;

describe('PortfolioStore', () => {
  it('loads the open orders and stats of a session, in journal order', () => {
    const p = new PortfolioStore();
    p.load({ session: {}, openOrders: [order('b', 2), order('a', 1)], stats } as unknown as SessionDetail);
    expect(p.orders().map((o) => o.id)).toEqual(['a', 'b']);
    expect(p.stats()).toBe(stats);
  });

  it('replaces local rows with the server rows returned (reconcile)', () => {
    const p = new PortfolioStore();
    p.load({ session: {}, openOrders: [order('a', 1)], stats } as unknown as SessionDetail);
    expect(p.applyOrders([order('a', 1, { status: 'open', entryPrice: 100 }), order('c', 3)])).toEqual([]);
    expect(p.orders().map((o) => [o.id, o.status])).toEqual([['a', 'open'], ['c', 'pending']]);
  });

  it('reports where a preview disagreed with the server, and keeps the server row', () => {
    const p = new PortfolioStore();
    p.setPreview(order('a', 1, { status: 'closed', exitPrice: 105, pnlCcy: 10 }));
    const mismatches = p.applyOrders([order('a', 1, { status: 'closed', exitPrice: 104, pnlCcy: 8 })]);
    expect(mismatches).toEqual([{ orderId: 'a', fields: ['exitPrice', 'pnlCcy'] }]);
    expect(p.orders()[0].exitPrice).toBe(104);
  });

  it('takes the full journal and the stats response (computed + drift)', () => {
    const p = new PortfolioStore();
    p.setOrders([order('b', 2, { status: 'closed' }), order('a', 1, { status: 'cancelled' })]);
    expect(p.orders().map((o) => [o.id, o.status])).toEqual([['a', 'cancelled'], ['b', 'closed']]);
    const computed = { trades: 2 } as unknown as SessionStats;
    p.applyStatsResponse({ computed, stored: {} as never, drift: true });
    expect(p.stats()).toBe(computed);
    expect(p.drift()).toBe(true);
  });

  it('accumulates fill events', () => {
    const p = new PortfolioStore();
    const e = { orderId: 'a', kind: 'fill', time: 1, price: 1, resolution: '1m' } as FillEvent;
    p.applyEvents([e]);
    p.applyEvents([]);
    p.applyEvents([e]);
    expect(p.events()).toHaveLength(2);
  });
});

describe('PortfolioStore — step previews (T-023)', () => {
  const COSTS = { enabled: false, commissionPct: 0, spread: 0 };
  const M = 60_000;
  const limitLong: Order = {
    id: '00000000-0000-4000-8000-000000000001', sessionId: 's', seq: 1, panelId: 'p1', instrument: 'binance:BTCUSDT',
    side: 'long', type: 'limit', status: 'pending', placedAtMs: 0, limitPrice: 99.5, entryPrice: null, entryTimeMs: null,
    qty: 200, contractMultiplier: 1, riskPct: 1, riskAmountCcy: 100, slInitial: 99, slCurrent: 99, tpInitial: 102, tpCurrent: 102, exitPrice: null,
    exitTimeMs: null, closeReason: null, fillResolution: null, slTpSameBar: false, commissionCcy: 0, spreadCostCcy: 0,
    pnlCcy: null, pnlR: null, maePrice: null, maeR: null, cancelledAtMs: null, createdAt: 0, updatedAt: 0,
  };
  const bar = (i: number, low: number) => ({ openTime: i * M, open: 100, high: 100.1, low, close: 100 });
  const filled: Order = { ...limitLong, status: 'open', entryPrice: 99.5, entryTimeMs: 0, fillResolution: '1m' };
  // stop 99 → (99 − 99.5) × 200 = −100, −1R
  const stopped: Order = { ...filled, status: 'closed', exitPrice: 99, exitTimeMs: 5 * M, closeReason: 'stop', commissionCcy: 0, spreadCostCcy: 0, pnlCcy: -100, pnlR: -1 };

  function seeded() {
    const p = new PortfolioStore();
    p.setOrders([limitLong]);
    return p;
  }

  it('a step preview is shown at once; the matching answer confirms it with no mismatch', () => {
    const p = seeded();
    const events = p.previewStep(5 * M, new Map([['p1', [bar(0, 99.4)]]]), COSTS);
    expect(events).toEqual([{ orderId: limitLong.id, kind: 'fill', time: 0, price: 99.5, resolution: '1m' }]);
    expect(p.orders()[0]).toMatchObject({ status: 'open', entryPrice: 99.5 });
    expect(p.applyAdvance(5 * M, [filled])).toEqual([]);
    expect(p.orders()[0]).toEqual(filled);
  });

  it("an answer for step 1 arriving after step 2's preview confirms step 1 and keeps showing step 2", () => {
    const p = seeded();
    p.previewStep(5 * M, new Map([['p1', [bar(0, 99.4)]]]), COSTS); // fill
    p.previewStep(10 * M, new Map([['p1', [bar(5, 98.9)]]]), COSTS); // stop
    expect(p.orders()[0].status).toBe('closed');
    expect(p.applyAdvance(5 * M, [filled])).toEqual([]);
    expect(p.orders()[0]).toMatchObject({ status: 'closed', exitPrice: 99 }); // still the newer preview
    expect(p.applyAdvance(10 * M, [stopped])).toEqual([]);
    expect(p.orders()[0]).toEqual(stopped);
  });

  it('a disagreeing answer is reported, wins, and voids the previews built on top of it', () => {
    const p = seeded();
    p.previewStep(5 * M, new Map([['p1', [bar(0, 99.4)]]]), COSTS);
    p.previewStep(10 * M, new Map([['p1', [bar(5, 98.9)]]]), COSTS);
    const serverFill = { ...filled, entryPrice: 99.49 };
    expect(p.applyAdvance(5 * M, [serverFill])).toEqual([{ orderId: limitLong.id, fields: ['entryPrice'] }]);
    expect(p.orders()[0]).toEqual(serverFill);
  });

  it('a previewed fill the answer does not mention is a mismatch; the pre-preview state is shown again', () => {
    const p = seeded();
    p.previewStep(5 * M, new Map([['p1', [bar(0, 99.4)]]]), COSTS);
    expect(p.applyAdvance(5 * M, [])).toEqual([{ orderId: limitLong.id, fields: ['status', 'entryPrice', 'entryTimeMs', 'fillResolution'] }]);
    expect(p.orders()[0]).toEqual(limitLong);
  });

  it('T-059: discardPreviews shows every previewed order as it was before its first preview (the halted session)', () => {
    const p = seeded();
    p.previewStep(5 * M, new Map([['p1', [bar(0, 99.4)]]]), COSTS); // fill
    p.previewStep(10 * M, new Map([['p1', [bar(5, 98.9)]]]), COSTS); // stop
    expect(p.orders()[0].status).toBe('closed');
    p.discardPreviews();
    expect(p.orders()[0]).toEqual(limitLong);
    expect(p.applyAdvance(5 * M, [])).toEqual([]); // nothing left to disagree with
  });

  it('T-059: discardPreviews keeps the rows an answer already confirmed', () => {
    const p = seeded();
    p.previewStep(5 * M, new Map([['p1', [bar(0, 99.4)]]]), COSTS);
    p.applyAdvance(5 * M, [filled]);
    p.previewStep(10 * M, new Map([['p1', [bar(5, 98.9)]]]), COSTS); // unanswered
    p.discardPreviews();
    expect(p.orders()[0]).toEqual(filled);
  });

  it('an order with a cancel or close on its way is not previewed', () => {
    const p = seeded();
    p.markPending(limitLong.id);
    expect(p.previewStep(5 * M, new Map([['p1', [bar(0, 99.4)]]]), COSTS)).toEqual([]);
    expect(p.orders()[0]).toEqual(limitLong);
    p.clearPending(limitLong.id);
    expect(p.previewStep(5 * M, new Map([['p1', [bar(0, 99.4)]]]), COSTS)).toHaveLength(1);
  });
});

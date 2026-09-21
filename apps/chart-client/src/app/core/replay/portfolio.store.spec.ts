import type { FillEvent, Order, SessionDetail, SessionStats } from '@trade-automation/contracts';
import { PortfolioStore } from './portfolio.store';

const order = (id: string, seq: number, extra: Partial<Order> = {}) =>
  ({ id, seq, status: 'pending', entryPrice: null, entryTimeMs: null, exitPrice: null, exitTimeMs: null, closeReason: null, fillResolution: null, qty: 1, pnlCcy: null, pnlR: null, ...extra }) as Order;
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

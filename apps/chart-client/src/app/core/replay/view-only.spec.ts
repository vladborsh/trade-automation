import type { Order } from '@trade-automation/contracts';
import { orderTool, viewAtFor } from './view-only';

const T = Date.UTC(2026, 8, 16, 10, 4);

describe('viewAtFor (§9.3)', () => {
  it('a filled order is viewed once its entry candle is revealed', () => {
    expect(viewAtFor({ entryTimeMs: T, placedAtMs: T + 60_000 })).toBe(T + 60_000);
  });

  it('an order that never filled is viewed where it was placed', () => {
    expect(viewAtFor({ entryTimeMs: null, placedAtMs: T })).toBe(T);
  });
});

describe('orderTool (the viewed order as a read-only position tool)', () => {
  const order = {
    id: 'o1', panelId: 'btc', side: 'long', type: 'market', status: 'closed', entryPrice: 100, limitPrice: null,
    slCurrent: 95, tpCurrent: 110, entryTimeMs: T, placedAtMs: T + 60_000,
  } as Order;

  it('a filled order is a position at its fill bar, never active', () => {
    expect(orderTool(order, '1m')).toEqual({
      id: 'view-o1', orderId: 'o1', side: 'long', mode: 'market', entry: 100, sl: 95, tp: 110, kind: 'position', active: false, anchorTime: T,
    });
    // 10:04 has no x on a 5m or 1h chart: the anchor is that bar's open
    expect(orderTool(order, '5m')?.anchorTime).toBe(Date.UTC(2026, 8, 16, 10, 0));
    expect(orderTool(order, '1h')?.anchorTime).toBe(Date.UTC(2026, 8, 16, 10, 0));
  });

  it('an unfilled limit is a pending tool at its limit, anchored where it was placed', () => {
    const tool = orderTool({ ...order, type: 'limit', status: 'cancelled', entryPrice: null, limitPrice: 98, entryTimeMs: null, tpCurrent: null }, '1m');
    expect(tool).toMatchObject({ kind: 'pending', mode: 'limit', entry: 98, tp: null, anchorTime: T + 60_000 });
  });
});

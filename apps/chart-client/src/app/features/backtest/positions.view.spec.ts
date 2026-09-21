import type { Order } from '@trade-automation/contracts';
import { positionRows } from './positions.view';

const base = { sessionId: 's', instrument: 'binance:BTCUSDT', riskPct: 1, riskAmountCcy: 100, slInitial: 0, tpInitial: null, tpCurrent: null, placedAtMs: 0, exitPrice: null, exitTimeMs: null, closeReason: null, fillResolution: null, slTpSameBar: false, commissionCcy: 0, spreadCostCcy: 0, pnlCcy: null, pnlR: null, maePrice: null, maeR: null, cancelledAtMs: null, createdAt: 0, updatedAt: 0 };
const order = (over: Partial<Order>): Order => ({ ...base, id: 'o', seq: 1, panelId: 'btc', side: 'long', type: 'market', status: 'open', limitPrice: null, entryPrice: 100, entryTimeMs: 0, qty: 10, slCurrent: 99, ...over }) as Order;
const COSTS = { enabled: true, commissionPct: 0.1, spread: 2 }; // half-spread 1

describe('positionRows (T-023)', () => {
  it('open: floating PnL from replay-core floatingPnl at the last close; risk from openRisk; pending risks nothing in the total', () => {
    const { rows, openRisk } = positionRows(
      [
        order({ id: 'a', seq: 1, entryPrice: 1001, slCurrent: 990 }),
        order({ id: 'b', seq: 2, type: 'limit', status: 'pending', limitPrice: 995, entryPrice: null, qty: 20, slCurrent: 990 }),
        order({ id: 'c', seq: 3, status: 'closed' }),
      ],
      () => 1010,
      COSTS,
    );
    // mark 1010 − 1 = 1009: (1009 − 1001) × 10 = 80, minus fees 10.01 + 10.09 = 59.9 (replay-core's own fixture)
    expect(rows.map((r) => [r.order.id, r.entry, r.risk])).toEqual([['a', 1001, 110], ['b', 995, 100]]);
    expect(rows[0].floating).toBeCloseTo(59.9, 9);
    expect(rows[1].floating).toBeNull();
    expect(openRisk).toBe(110);
  });

  it('no last close yet → no floating PnL', () => {
    expect(positionRows([order({})], () => null, COSTS).rows[0].floating).toBeNull();
  });
});

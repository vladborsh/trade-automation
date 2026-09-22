import type { Order } from '@trade-automation/contracts';
import { FILL_TABLE_FIXTURES, computeTradeResult } from '@trade-automation/replay-core';
import { previewStep } from './order-preview';

/** A full contract Order from a fill-table fixture's order (qty 10, 1R = 100). */
function orderFrom(f: (typeof FILL_TABLE_FIXTURES)[number]): Order {
  const o = f.order;
  return {
    id: o.id, sessionId: '00000000-0000-4000-8000-0000000000aa', seq: 1, panelId: 'p1', instrument: 'binance:BTCUSDT',
    side: o.side, type: o.type, status: o.status, placedAtMs: 0, limitPrice: o.limitPrice, entryPrice: o.entryPrice,
    entryTimeMs: o.entryTimeMs, qty: 10, contractMultiplier: 1, riskPct: 1, riskAmountCcy: 100, slInitial: o.slCurrent, slCurrent: o.slCurrent,
    tpInitial: o.tpCurrent, tpCurrent: o.tpCurrent, exitPrice: null, exitTimeMs: null, closeReason: null,
    fillResolution: o.status === 'open' ? '1m' : null, slTpSameBar: false, commissionCcy: 0, spreadCostCcy: 0,
    pnlCcy: null, pnlR: null, maePrice: null, maeR: null, cancelledAtMs: null, createdAt: 0, updatedAt: 0,
  };
}

describe('previewStep — the §6 fill table, as the client previews it (T-023)', () => {
  const oneMinute = FILL_TABLE_FIXTURES.filter((f) => f.walk === '1m');

  it.each(oneMinute.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const before = orderFrom(f);
    const { orders, events } = previewStep([before], new Map([['p1', f.path]]), f.costs);

    expect(events).toEqual(f.expected.map(({ slTpSameBar: _s, ...e }) => e));
    if (f.expected.length === 0) {
      expect(orders).toEqual([]);
      return;
    }
    const after = orders[0];
    const fill = f.expected.find((e) => e.kind === 'fill');
    const exit = f.expected.find((e) => e.kind === 'exit');
    if (fill) expect(after).toMatchObject({ entryPrice: fill.price, entryTimeMs: fill.time, fillResolution: '1m' });
    if (!exit) {
      expect(after.status).toBe('open');
      return;
    }
    const entered = fill ? { ...before, entryPrice: fill.price, entryTimeMs: fill.time } : before;
    const r = computeTradeResult(entered, exit, f.costs);
    expect(after).toMatchObject({
      status: 'closed', exitPrice: exit.price, exitTimeMs: exit.time, closeReason: exit.reason,
      slTpSameBar: exit.slTpSameBar === true, fillResolution: '1m',
      pnlCcy: Number(r.pnlCcy.toFixed(8)), pnlR: Number(r.pnlR.toFixed(6)),
      commissionCcy: Number(r.commissionCcy.toFixed(8)), spreadCostCcy: Number(r.spreadCostCcy.toFixed(8)),
    });
  });

  it('covers every 1m row for long and short', () => {
    expect(new Set(oneMinute.map((f) => `${f.row}|${f.side}`)).size).toBe(12);
  });

  it('leaves alone: closed/cancelled orders, orders being cancelled or closed, other panels, empty spans', () => {
    const f = oneMinute.find((x) => x.expected.length > 0)!;
    const o = orderFrom(f);
    const path = new Map([['p1', f.path]]);
    expect(previewStep([{ ...o, status: 'closed' }], path, f.costs).orders).toEqual([]);
    expect(previewStep([{ ...o, status: 'cancelled' }], path, f.costs).orders).toEqual([]);
    expect(previewStep([o], path, f.costs, new Set([o.id])).orders).toEqual([]);
    expect(previewStep([{ ...o, panelId: 'p2' }], path, f.costs).orders).toEqual([]);
    expect(previewStep([o], new Map([['p1', []]]), f.costs).orders).toEqual([]);
  });
});

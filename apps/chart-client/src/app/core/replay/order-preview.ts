import type { Costs, FillEvent, Order } from '@trade-automation/contracts';
import { computeTradeResult, evaluateOrder, type EngineFillEvent, type PathBar } from '@trade-automation/replay-core';

/** The server rounds once when writing (§12.9): money numeric(20,8), R numeric(20,6). */
const money = (v: number) => Number(v.toFixed(8));
const rMultiple = (v: number) => Number(v.toFixed(6));

/**
 * backtest-app-system-design.md §5.4 step 3, §5.5 — the client's preview of one step, so a drawing
 * flips pending → position → gone before the server answers. For every pending/open order whose
 * panel revealed 1m candles this step, replay-core's `evaluateOrder` walks exactly the span the
 * server walks for the same advance, and the result is written into the order the way
 * `AdvanceService` writes it: the fill (entry price and time, `1m`), then the exit (price, time,
 * reason, `sl_tp_same_bar`, and costs / PnL / R from `computeTradeResult`, rounded to the columns'
 * scale). MAE is left to the server. Orders in `skip` (a cancel or close is on its way) and orders
 * without revealed candles are untouched. The end-of-session force close and the pessimistic
 * fallback are the server's alone: the client only has 1m, and the end of the period completes the
 * session on the server's answer.
 */
export function previewStep(
  orders: readonly Order[],
  revealed: ReadonlyMap<string, readonly PathBar[]>,
  costs: Costs,
  skip: ReadonlySet<string> = new Set(),
): { orders: Order[]; events: FillEvent[] } {
  const changed: Order[] = [];
  const events: FillEvent[] = [];
  for (const order of orders) {
    if ((order.status !== 'pending' && order.status !== 'open') || skip.has(order.id)) continue;
    const bars = revealed.get(order.panelId);
    if (!bars || bars.length === 0) continue;
    let next = order;
    for (const event of evaluateOrder(order, bars, costs)) {
      next = event.kind === 'fill' ? filled(next, event) : exited(next, event, costs);
      events.push(wire(event));
    }
    if (next !== order) changed.push(next);
  }
  return { orders: changed, events };
}

function filled(order: Order, e: EngineFillEvent): Order {
  return { ...order, status: 'open', entryPrice: money(e.price), entryTimeMs: e.time, fillResolution: e.resolution };
}

function exited(order: Order, e: EngineFillEvent, costs: Costs): Order {
  const r = computeTradeResult(order, e, costs);
  return {
    ...order,
    status: 'closed',
    exitPrice: money(e.price),
    exitTimeMs: e.time,
    closeReason: e.reason ?? null,
    fillResolution: order.fillResolution === 'pessimistic-bar' || e.resolution === 'pessimistic-bar' ? 'pessimistic-bar' : '1m',
    slTpSameBar: e.slTpSameBar === true,
    commissionCcy: money(r.commissionCcy),
    spreadCostCcy: money(r.spreadCostCcy),
    pnlCcy: money(r.pnlCcy),
    pnlR: rMultiple(r.pnlR),
  };
}

function wire(e: EngineFillEvent): FillEvent {
  const { slTpSameBar: _sameBar, ...event } = e;
  return event;
}

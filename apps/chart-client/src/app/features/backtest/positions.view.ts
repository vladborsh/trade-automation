import type { Costs, Order } from '@trade-automation/contracts';
import { floatingPnl, openRisk } from '@trade-automation/replay-core';

export interface PositionRow {
  order: Order;
  /** The fill price of a position, the limit of a pending order. */
  entry: number;
  /** Open only: replay-core `floatingPnl` at the last close adjusted for spread (decision 35). */
  floating: number | null;
  /** What the current stop would lose (open: `openRisk`; pending: the same, from the limit). */
  risk: number;
}

/**
 * T-023 — the positions panel: pending and open orders, by `seq`, with the floating PnL of each
 * position marked at its panel's last revealed 1m close adjusted for spread (replay-core `mark`,
 * recomputed every step), each order's risk, and the total open risk (`openRisk` over the open
 * positions — pending orders risk nothing until filled). No other money figure is computed here.
 */
export function positionRows(
  orders: readonly Order[],
  lastCloseOf: (panelId: string) => number | null,
  costs: Costs,
): { rows: PositionRow[]; openRisk: number } {
  const live = orders.filter((o) => o.status === 'pending' || o.status === 'open');
  const rows = live.map((order): PositionRow => {
    if (order.status === 'open') {
      const last = lastCloseOf(order.panelId);
      return { order, entry: order.entryPrice as number, floating: last === null ? null : floatingPnl(order, last, costs), risk: openRisk([order]) };
    }
    const limit = order.limitPrice as number;
    return { order, entry: limit, floating: null, risk: openRisk([{ ...order, entryPrice: limit }]) };
  });
  return { rows, openRisk: openRisk(live.filter((o) => o.status === 'open')) };
}

import { Costs, FillEvent, Order } from '@trade-automation/contracts';
import { direction, fee, spreadCost } from '../costs';

export interface TradeResult {
  commissionCcy: number;
  spreadCostCcy: number;
  pnlCcy: number;
  pnlR: number;
}

/**
 * architecture/backtest-app-system-design.md §6 "Costs": the money side of a closed trade.
 *
 * - `commission_ccy = fee(entry notional) + fee(exit notional)`;
 * - `spread_cost_ccy = half * qty * sides that paid it` — a market entry pays on entry; stop,
 *   manual and end-of-session exits pay on exit; limit entries and take-profits do not. Reported
 *   only: the half-spread is already inside `entryPrice` / `exitEvent.price`;
 * - `pnl_ccy = dir * (exit - entry) * qty - commission_ccy`; `pnl_r = pnl_ccy / riskAmountCcy`.
 *
 * `costs` is the session's cost model (commission is not recoverable from the prices).
 */
export function computeTradeResult(
  order: Pick<Order, 'id' | 'side' | 'type' | 'entryPrice' | 'qty' | 'riskAmountCcy'>,
  exitEvent: FillEvent,
  costs: Costs,
): TradeResult {
  if (exitEvent.kind !== 'exit' || exitEvent.reason === undefined) {
    throw new Error(`order ${order.id}: computeTradeResult needs an exit event with a reason`);
  }
  if (order.entryPrice === null) throw new Error(`order ${order.id}: no entryPrice`);
  const { entryPrice: entry, qty } = order;
  const exit = exitEvent.price;

  const commissionCcy = fee(entry * qty, costs) + fee(exit * qty, costs);
  const sidesPaid = ((order.type === 'market' ? 1 : 0) + (exitEvent.reason === 'take-profit' ? 0 : 1)) as 0 | 1 | 2;
  const pnlCcy = direction(order.side) * (exit - entry) * qty - commissionCcy;
  return {
    commissionCcy,
    spreadCostCcy: spreadCost(qty, sidesPaid, costs),
    pnlCcy,
    pnlR: pnlCcy / order.riskAmountCcy,
  };
}

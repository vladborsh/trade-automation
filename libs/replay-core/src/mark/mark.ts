import { Costs, Order } from '@trade-automation/contracts';
import { contractUnits, direction, fee, marketExitPrice } from '../costs';

/** The `Order` fields the floating mark reads; a contract `Order` in status `open` is assignable. */
export type MarkablePosition = Pick<Order, 'id' | 'side' | 'entryPrice' | 'qty' | 'contractMultiplier'>;

/**
 * architecture/backtest-app-system-design.md §6 "Floating mark" (decision 35): what closing right
 * now would return. `mark = lastClose ∓ half` (the market-exit price); `floating = dir * (mark -
 * entry) * qty - fee(entry notional) - fee(mark notional)`, where `qty` is `qty × contractMultiplier`
 * (D12).
 */
export function floatingPnl(position: MarkablePosition, lastClose: number, costs: Costs): number {
  const entry = requireEntry(position);
  const mark = marketExitPrice(position.side, lastClose, costs);
  const qty = contractUnits(position);
  return direction(position.side) * (mark - entry) * qty - fee(entry * qty, costs) - fee(mark * qty, costs);
}

/**
 * §6 `openRisk` (decision 22): Σ over open positions of what their current stops would lose,
 * spread aside — `(entry - sl_current) * qty` for a long, `(sl_current - entry) * qty` for a
 * short. A stop already moved past entry locks in a gain and contributes 0, not `|entry - sl|`.
 */
export function openRisk(positions: readonly (MarkablePosition & Pick<Order, 'slCurrent'>)[]): number {
  let total = 0;
  for (const p of positions) {
    const loss = direction(p.side) * (requireEntry(p) - p.slCurrent) * contractUnits(p);
    if (loss > 0) total += loss;
  }
  return total;
}

function requireEntry(position: MarkablePosition): number {
  if (position.entryPrice === null) throw new Error(`order ${position.id}: not an open position (no entryPrice)`);
  return position.entryPrice;
}

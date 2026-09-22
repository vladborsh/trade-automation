import { Order } from '@trade-automation/contracts';
import { contractUnits, type MultiplierInput } from '../costs';
import { PathBar } from './types';

/**
 * architecture/backtest-app-system-design.md §6 "MAE" (decision 26): the worst adverse excursion
 * on the 1m path between `entryTimeMs` and `exitTimeMs` — long `entry - min(low)`, short
 * `max(high) - entry`; `maeR = maePrice * qty / riskAmountCcy` (`qty × contractMultiplier`, D12).
 * Computed once, at close.
 *
 * Window: the exit candle is included. The entry candle is included for a **limit** order (the
 * position was open for part of its fill candle — the conservative choice) and excluded for a
 * **market** order, whose entry candle closed before the order was placed. Floored at 0: a trade
 * that never traded below (long) / above (short) its entry had no adverse excursion. Bars outside
 * the window are ignored, so the caller may pass a superset.
 */
export function computeMae(
  order: Pick<Order, 'id' | 'side' | 'type' | 'entryPrice' | 'entryTimeMs' | 'exitTimeMs' | 'qty' | 'riskAmountCcy'> & MultiplierInput,
  path: readonly PathBar[],
): { maePrice: number; maeR: number } {
  const { entryPrice: entry, entryTimeMs: from, exitTimeMs: to } = order;
  if (entry === null || from === null || to === null) {
    throw new Error(`order ${order.id}: computeMae needs entryPrice, entryTimeMs and exitTimeMs`);
  }
  let maePrice = 0;
  for (const bar of path) {
    if (bar.openTime < from || bar.openTime > to) continue;
    if (order.type === 'market' && bar.openTime === from) continue;
    const excursion = order.side === 'long' ? entry - bar.low : bar.high - entry;
    if (excursion > maePrice) maePrice = excursion;
  }
  return { maePrice, maeR: (maePrice * contractUnits(order)) / order.riskAmountCcy };
}

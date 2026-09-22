import { Costs, OrderSide } from '@trade-automation/contracts';

/**
 * architecture/backtest-app-system-design.md §6 — the cost model. `spread` is the full bid/ask
 * width in price units and the stored OHLC is treated as mid, so every side that crosses the
 * spread pays half of it adversely. `enabled: false` switches both spread and commission off.
 */

/** `half = enabled ? spread / 2 : 0`. */
export function halfSpread(costs: Costs): number {
  return costs.enabled ? costs.spread / 2 : 0;
}

/** `fee(notional) = enabled ? notional * commissionPct / 100 : 0` — one side's commission. */
export function fee(notional: number, costs: Costs): number {
  return costs.enabled ? (notional * costs.commissionPct) / 100 : 0;
}

/**
 * D12 (§6 "Contract, sizing and margin"): the quantity every money formula multiplies by,
 * `qty × contractMultiplier` (notional = units × price). An absent multiplier is 1, which is every
 * configured instrument today, so `units === qty` exactly and no existing number changes.
 */
export function contractUnits(order: { qty: number; contractMultiplier?: number }): number {
  return order.qty * (order.contractMultiplier ?? 1);
}

/** +1 for long, -1 for short: `pnl = dir * (exit - entry) * qty`. */
export function direction(side: OrderSide): 1 | -1 {
  return side === 'long' ? 1 : -1;
}

/** §6 "Market entry at placement": long `lastClose + half`, short `lastClose - half`. */
export function marketFillPrice(side: OrderSide, lastClose: number, costs: Costs): number {
  return lastClose + direction(side) * halfSpread(costs);
}

/**
 * §6 "Manual close / end of session", also the floating mark (decision 35): long
 * `lastClose - half`, short `lastClose + half`.
 */
export function marketExitPrice(side: OrderSide, lastClose: number, costs: Costs): number {
  return lastClose - direction(side) * halfSpread(costs);
}

/**
 * §6 "Stop exit": long `sl - half`, or `open - half` when the candle opened through the stop
 * (`open < sl`); short `sl + half`, or `open + half` when `open > sl`. Pass `open = null` when the
 * position did not exist at the candle's open (the limit-fill candle), so no gap-through applies.
 */
export function stopExitPrice(side: OrderSide, sl: number, open: number | null, costs: Costs): number {
  const level = open === null ? sl : side === 'long' ? Math.min(sl, open) : Math.max(sl, open);
  return level - direction(side) * halfSpread(costs);
}

/**
 * §6 "Take-profit exit": at `tp`, or at `open` when the candle opened through it (long
 * `open > tp`, short `open < tp`). No spread — a resting limit. `open = null` as in
 * `stopExitPrice`.
 */
export function takeProfitExitPrice(side: OrderSide, tp: number, open: number | null): number {
  if (open === null) return tp;
  return side === 'long' ? Math.max(tp, open) : Math.min(tp, open);
}

/** §6 `spread_cost_ccy = half * qty * (sides that paid it)` — reported, already in the prices. */
export function spreadCost(qty: number, sidesPaid: 0 | 1 | 2, costs: Costs): number {
  return halfSpread(costs) * qty * sidesPaid;
}

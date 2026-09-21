import { BacktestErrorCode, OrderSide, OrderType } from '@trade-automation/contracts';

export interface OrderLevels {
  side: OrderSide;
  type: OrderType;
  limitPrice?: number;
  sl: number;
  tp?: number;
}

/**
 * architecture/backtest-app-system-design.md §7.2 — the level checks for POST …/orders, against
 * the planned entry (the limit level, or `lastClose` for a market order — the same entry
 * `positionSize` sizes from, §6). Checked in this order, first failure wins:
 *
 * 1. `LIMIT_ON_WRONG_SIDE` — a long limit must be strictly below `lastClose`, a short strictly
 *    above (stop entries are not in v1, §13 decision 29);
 * 2. `STOP_DISTANCE_ZERO` — `sl` equals the planned entry;
 * 3. `SL_ON_WRONG_SIDE` — a long stop must be below the entry, a short stop above;
 * 4. `TP_ON_WRONG_SIDE` — when given, a long target must be above the entry, a short below.
 *
 * Returns `null` when the levels are acceptable. `limitPrice` is required for a limit order by
 * the request schema.
 */
export function orderLevelError(o: OrderLevels, lastClose: number): BacktestErrorCode | null {
  const long = o.side === 'long';
  if (o.type === 'limit') {
    const limit = o.limitPrice as number;
    if (long ? limit >= lastClose : limit <= lastClose) return 'LIMIT_ON_WRONG_SIDE';
  }
  const entry = o.type === 'limit' ? (o.limitPrice as number) : lastClose;
  if (o.sl === entry) return 'STOP_DISTANCE_ZERO';
  if (long ? o.sl > entry : o.sl < entry) return 'SL_ON_WRONG_SIDE';
  if (o.tp !== undefined && (long ? o.tp <= entry : o.tp >= entry)) return 'TP_ON_WRONG_SIDE';
  return null;
}

/** The planned entry `positionSize` sizes from (§6 "Sizing"). */
export function plannedEntry(o: Pick<OrderLevels, 'type' | 'limitPrice'>, lastClose: number): number {
  return o.type === 'limit' ? (o.limitPrice as number) : lastClose;
}

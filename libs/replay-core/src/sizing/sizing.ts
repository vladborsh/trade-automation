/**
 * architecture/backtest-app-system-design.md §6 "Sizing" (decision 21): `riskAmount = balance *
 * riskPct / 100`; `qty = riskAmount / |plannedEntry - sl|`, where `plannedEntry` is the tool's
 * entry (the limit level, or the last close for a market order). Both are fixed at placement —
 * the spread does not re-size the order.
 *
 * Throws `RangeError` when the order cannot be sized: a zero stop distance (the server maps this
 * to `STOP_DISTANCE_ZERO`) or a non-positive balance / risk % (1R would be zero or negative).
 */
export function positionSize(
  balance: number,
  riskPct: number,
  plannedEntry: number,
  sl: number,
): { qty: number; riskAmount: number } {
  const distance = Math.abs(plannedEntry - sl);
  if (!(distance > 0)) throw new RangeError(`stop distance must be > 0 (entry ${plannedEntry}, sl ${sl})`);
  if (!(balance > 0)) throw new RangeError(`balance must be > 0 to size an order (got ${balance})`);
  if (!(riskPct > 0)) throw new RangeError(`riskPct must be > 0 (got ${riskPct})`);
  const riskAmount = (balance * riskPct) / 100;
  return { qty: riskAmount / distance, riskAmount };
}

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

/**
 * BUG-003 follow-up (Tech Lead ruling, provisional pending Architect confirmation): the minimum
 * stop distance, as a fraction of the planned entry — 0.001 % of price (BTC at 78 000 → 0.78).
 * A closer stop is "effectively at the entry": it sizes an absurd position and an R multiple no
 * column can hold. The server refuses it (422 `STOP_DISTANCE_ZERO`); the client's order panel
 * applies the same rule.
 */
export const MIN_STOP_DISTANCE_FRACTION = 1e-5;

/**
 * True when `|plannedEntry − sl| < plannedEntry × MIN_STOP_DISTANCE_FRACTION`. A stop exactly at
 * the minimum is accepted: the comparison allows a 1e-9 relative float slack, so e.g. entry
 * 78 000 with sl 77 999.22 (0.78 away, which float subtraction yields as 0.77999…) passes.
 */
export function isStopTooClose(plannedEntry: number, sl: number): boolean {
  const min = Math.abs(plannedEntry) * MIN_STOP_DISTANCE_FRACTION;
  return Math.abs(plannedEntry - sl) < min * (1 - 1e-9);
}

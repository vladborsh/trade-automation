import type { ContractSpec } from '@trade-automation/contracts';

/** What `positionSize` returns: the size, the 1R actually at risk, and the risk that was asked for. */
export interface PositionSize {
  qty: number;
  /** 1R: `qty × |entry − sl| × multiplier`, the amount actually at risk after rounding. */
  riskAmount: number;
  /** `balance × riskPct / 100`, before rounding. */
  requestedRisk: number;
}

/**
 * architecture/backtest-app-system-design.md §6 "Sizing" (decision 21) and "Contract, sizing and
 * margin" (D12): `requestedRisk = balance × riskPct / 100`, then
 * `raw = requestedRisk / (|plannedEntry − sl| × multiplier)` and `qty = floorToStep(raw, qtyStep)`:
 * rounded **down**, never up, so the trader never risks more than asked. `riskAmount` (1R) is what
 * is actually at risk after rounding. `plannedEntry` is the tool's entry (the limit, or the last close
 * for a market order); both are fixed at placement, and the spread does not re-size the order.
 *
 * Without `contract` (every caller before T-053/T-054) nothing is rounded: `qty = requestedRisk /
 * distance` and `riskAmount = requestedRisk`, exactly as before D12.
 *
 * Throws `RangeError` when the order cannot be sized: a zero stop distance (the server maps this
 * to `STOP_DISTANCE_ZERO`) or a non-positive balance / risk % (1R would be zero or negative). A size
 * that rounds to 0 is not an error here: `placementCheck` refuses it as `SIZE_BELOW_MINIMUM`.
 */
export function positionSize(
  balance: number,
  riskPct: number,
  plannedEntry: number,
  sl: number,
  contract?: Pick<ContractSpec, 'multiplier' | 'qtyStep'>,
): PositionSize {
  const distance = Math.abs(plannedEntry - sl);
  if (!(distance > 0)) throw new RangeError(`stop distance must be > 0 (entry ${plannedEntry}, sl ${sl})`);
  if (!(balance > 0)) throw new RangeError(`balance must be > 0 to size an order (got ${balance})`);
  if (!(riskPct > 0)) throw new RangeError(`riskPct must be > 0 (got ${riskPct})`);
  const requestedRisk = (balance * riskPct) / 100;
  if (!contract) return { qty: requestedRisk / distance, riskAmount: requestedRisk, requestedRisk };
  const qty = floorToStep(requestedRisk / (distance * contract.multiplier), contract.qtyStep);
  return { qty, riskAmount: qty * distance * contract.multiplier, requestedRisk };
}

/** The number of decimals in `step` as written: 0.001 → 3, 100 → 0, 1e-8 → 8, 2.5e-7 → 8. */
export function stepDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) throw new RangeError(`step must be a positive number (got ${step})`);
  const [mantissa, exponent] = step.toString().split('e');
  const fraction = (mantissa.split('.')[1] ?? '').length;
  return Math.max(0, fraction - Number(exponent ?? 0));
}

/**
 * The largest multiple of `step` at or below `value`, as a clean decimal. A 1e-9 relative epsilon
 * keeps a value that float arithmetic left a hair below a step (0.3 / 0.1 = 2.9999…) on that step.
 */
export function floorToStep(value: number, step: number): number {
  const decimals = stepDecimals(step);
  const n = Math.floor((value / step) * (1 + 1e-9));
  return n <= 0 ? 0 : Number((n * step).toFixed(decimals));
}

/** The smallest multiple of `step` at or above `value`, as a clean decimal (the same epsilon, downwards). */
export function ceilToStep(value: number, step: number): number {
  const decimals = stepDecimals(step);
  const n = Math.ceil((value / step) * (1 - 1e-9));
  return Number((Math.max(0, n) * step).toFixed(decimals));
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

import type { ContractSpec, Costs, InstrumentId, Order } from '@trade-automation/contracts';
import { contractUnits, type MultiplierInput } from '../costs';
import { floatingPnl } from '../mark';
import { ceilToStep, stepDecimals } from './sizing';

/**
 * architecture/backtest-app-system-design.md §6 "Contract, sizing and margin" (D12): the venue
 * minimums and the margin check a placement must pass, against one pooled account per session.
 * No maintenance margin, no margin call, no liquidation (decision 25's surviving half). Checked at
 * placement only: modify, cancel, close and advance never re-check (qty never changes).
 */

/** `notional = qty × multiplier × price`, in the quote currency. */
export function notional(qty: number, price: number, contract: Pick<ContractSpec, 'multiplier'>): number {
  return qty * contract.multiplier * price;
}

/** Initial margin at `price`: `notional / maxLeverage`. */
export function marginRequired(qty: number, price: number, contract: Pick<ContractSpec, 'multiplier' | 'maxLeverage'>): number {
  return notional(qty, price, contract) / contract.maxLeverage;
}

/**
 * An open or pending order as the margin account sees it: its own snapshot multiplier (absent = 1)
 * and its instrument's leverage cap. Other statuses are ignored.
 */
export type MarginOrder = Pick<Order, 'id' | 'instrument' | 'side' | 'status' | 'qty' | 'entryPrice' | 'limitPrice'> & MultiplierInput & {
  maxLeverage: number;
};

export interface AccountMargin {
  /** `balance + Σ floatingPnl(open)`. */
  equity: number;
  /** `Σ` initial margin of the open (at entry) and pending (at limit) orders. */
  usedMargin: number;
  /** `equity − usedMargin`; negative when floating losses outrun the balance. */
  available: number;
}

/**
 * The session account at the cursor. `equity = balance + Σ floatingPnl(open)`, each open position
 * marked at its instrument's last close (the market-exit price, fees included; decision 35).
 * `usedMargin` sums each order's initial margin: open orders at their entry, pending orders at their
 * limit (both venues reserve margin for resting orders). Throws when an open position's instrument
 * has no last close: equity cannot be computed without it.
 */
export function accountMargin(
  balance: number,
  orders: readonly MarginOrder[],
  lastCloseByInstrument: ReadonlyMap<InstrumentId, number>,
  costs: Costs,
): AccountMargin {
  let floating = 0;
  let usedMargin = 0;
  for (const o of orders) {
    if (o.status === 'open') {
      const lastClose = lastCloseByInstrument.get(o.instrument);
      if (lastClose === undefined) throw new Error(`order ${o.id}: no last close for ${o.instrument}, cannot mark it`);
      floating += floatingPnl(o, lastClose, costs);
      usedMargin += (contractUnits(o) * (o.entryPrice as number)) / o.maxLeverage;
    } else if (o.status === 'pending') {
      usedMargin += (contractUnits(o) * (o.limitPrice ?? o.entryPrice ?? 0)) / o.maxLeverage;
    }
  }
  const equity = balance + floating;
  return { equity, usedMargin, available: equity - usedMargin };
}

export type PlacementRefusal = 'SIZE_BELOW_MINIMUM' | 'INSUFFICIENT_MARGIN';

/**
 * D12's two refusals, in order: below the venue minimum (`qty < minQty`, or `minNotional` set and
 * `notional < minNotional`) → `SIZE_BELOW_MINIMUM`; then `marginRequired > available` →
 * `INSUFFICIENT_MARGIN`. Never sized up silently. A 1e-9 relative slack absorbs float noise at the
 * boundary (a size exactly at the minimum passes).
 */
export function placementCheck(input: {
  qty: number;
  notional: number;
  contract: Pick<ContractSpec, 'minQty' | 'minNotional'>;
  marginRequired: number;
  available: number;
}): PlacementRefusal | null {
  const { qty, contract } = input;
  if (qty < contract.minQty * (1 - 1e-9)) return 'SIZE_BELOW_MINIMUM';
  if (contract.minNotional !== undefined && input.notional < contract.minNotional * (1 - 1e-9)) return 'SIZE_BELOW_MINIMUM';
  if (input.marginRequired > input.available + 1e-9 * Math.max(1, Math.abs(input.available))) return 'INSUFFICIENT_MARGIN';
  return null;
}

/**
 * The smallest order the venue accepts at `price`: the larger of `minQty` and the size that reaches
 * `minNotional`, rounded **up** to `qtyStep`.
 */
export function minimumOrderSize(contract: Pick<ContractSpec, 'minQty' | 'minNotional' | 'qtyStep' | 'multiplier'>, price: number): number {
  const byNotional = contract.minNotional !== undefined ? contract.minNotional / (contract.multiplier * price) : 0;
  return ceilToStep(Math.max(contract.minQty, byNotional), contract.qtyStep);
}

/**
 * The risk % that sizes to at least `qty` at this stop distance, rounded **up** to 0.01 % (so
 * entering it really reaches the size).
 */
export function riskPctForSize(qty: number, stopDistance: number, contract: Pick<ContractSpec, 'multiplier'>, balance: number): number {
  const pct = ((qty * stopDistance * contract.multiplier) / balance) * 100;
  return Math.ceil(pct * 100 * (1 - 1e-9)) / 100;
}

/**
 * The `SIZE_BELOW_MINIMUM` message: the minimum size and the risk % it would need, e.g.
 * "Below the venue minimum: the smallest order is 0.001 BTC (at least 50 notional), which needs a
 * risk of at least 0.35 % at this stop."
 */
export function sizeBelowMinimumMessage(
  contract: Pick<ContractSpec, 'unit' | 'minQty' | 'minNotional' | 'qtyStep' | 'multiplier'>,
  price: number,
  stopDistance: number,
  balance: number,
): string {
  const min = minimumOrderSize(contract, price);
  const pct = riskPctForSize(min, stopDistance, contract, balance);
  const floor = contract.minNotional !== undefined ? ` (at least ${contract.minNotional} notional)` : '';
  return (
    `Below the venue minimum: the smallest order is ${min.toFixed(stepDecimals(contract.qtyStep))} ${contract.unit}${floor}, ` +
    `which needs a risk of at least ${pct.toFixed(2)} % at this stop.`
  );
}

/** The `INSUFFICIENT_MARGIN` message, amounts to 2 decimals in the session currency. */
export function insufficientMarginMessage(required: number, available: number, currency: string): string {
  return `Not enough margin: this order needs ${required.toFixed(2)} ${currency} and ${Math.max(0, available).toFixed(2)} ${currency} is available.`;
}

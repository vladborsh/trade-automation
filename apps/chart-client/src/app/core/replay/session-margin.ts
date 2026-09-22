import type { ContractSpec, Costs, InstrumentId, Order } from '@trade-automation/contracts';
import { type AccountMargin, accountMargin } from '@trade-automation/replay-core';

/**
 * T-054 — the session account at the cursor (design §6 D12): replay-core's `accountMargin` over the
 * open and pending orders, each at its instrument's leverage cap and its own snapshot multiplier,
 * the open ones marked at their instrument's last revealed close. Null when an open position cannot
 * be marked (its instrument has no panel, or no bar yet): the popup then leaves the margin check to
 * the server, and the toolbar shows no utilisation.
 */
export function sessionMargin(
  balance: number,
  orders: readonly Order[],
  contractOf: (id: InstrumentId) => ContractSpec | null,
  lastCloseByInstrument: ReadonlyMap<InstrumentId, number>,
  costs: Costs,
): AccountMargin | null {
  const live = orders
    .filter((o) => o.status === 'open' || o.status === 'pending')
    .map((o) => ({ ...o, maxLeverage: contractOf(o.instrument)?.maxLeverage ?? 1 }));
  try {
    return accountMargin(balance, live, lastCloseByInstrument, costs);
  } catch {
    return null;
  }
}

/** Used margin ÷ equity (the toolbar's "margin 34 %"); null without an account or a positive equity. */
export function marginUtilisation(account: AccountMargin | null): number | null {
  return account && account.equity > 0 ? account.usedMargin / account.equity : null;
}

/** Instrument → its panel's last revealed close; panels without a bar yet are left out. */
export function lastClosesByInstrument(
  panels: readonly { id: string; instrument: InstrumentId }[],
  lastCloseOf: (panelId: string) => number | null,
): Map<InstrumentId, number> {
  return new Map(
    panels.flatMap((p) => {
      const close = lastCloseOf(p.id);
      return close === null ? [] : [[p.instrument, close] as const];
    }),
  );
}

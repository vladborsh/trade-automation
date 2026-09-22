import type { ContractSpec } from '@trade-automation/contracts';
import { type AccountMargin, stepDecimals } from '@trade-automation/replay-core';
import type { PositionToolState } from '../chart/overlay/position-tool.model';
import { rMultiple } from '../chart/overlay/position-tool.geometry';
import { MARGIN_AMBER_UTILISATION, type OrderSizing, sizeOrder } from '../../core/replay/order-sizing';

export interface OrderPanelView {
  side: PositionToolState['side'];
  mode: PositionToolState['mode'];
  entry: number;
  rMultiple: number | null;
  /** The size and D12 figures (null when the draft cannot be sized at all). */
  sizing: OrderSizing | null;
  /** "0.076 BTC", "20,000 EUR (0.20 lots)" — the qty on the venue step, in its unit. */
  sizeText: string | null;
  /** "0.5x of 125x" — this order's notional against equity, and the instrument's cap. */
  leverageText: string | null;
  /** The risk % asked for; `sizing.effectiveRiskPct` is what the rounded size really takes. */
  requestedRiskPct: number;
  /** Margin in use after this order above 80 % of equity (design §6 D12). */
  amber: boolean;
  /** Why it cannot be confirmed: the server's refusal (venue minimum, margin), or why no size exists. */
  problem: string | null;
}

export interface OrderPanelContext {
  balance: number;
  riskPct: number;
  lastClose: number;
  contract: ContractSpec | null;
  account: AccountMargin | null;
  currency: string;
}

/**
 * T-023, T-054 — what the order popup shows for the active draft: the size rounded to the venue
 * step in its unit (with lots for FX), 1R and the effective risk % against the requested one, the
 * reward multiple, notional, margin required and free margin after, implied leverage against the
 * cap, and the D12 refusal that disables Confirm — all from `sizeOrder`, i.e. the server's own
 * rules. The entry is the last close for a market draft (what it fills at).
 */
export function orderPanelView(draft: PositionToolState, ctx: OrderPanelContext): OrderPanelView {
  const entry = draft.mode === 'market' ? ctx.lastClose : draft.entry;
  const base = { side: draft.side, mode: draft.mode, entry, rMultiple: rMultiple({ entry, sl: draft.sl, tp: draft.tp }), requestedRiskPct: ctx.riskPct };
  try {
    const sizing = sizeOrder({ mode: draft.mode, entry: draft.entry, sl: draft.sl, lastClose: ctx.lastClose, balance: ctx.balance, riskPct: ctx.riskPct, contract: ctx.contract, account: ctx.account, currency: ctx.currency });
    return {
      ...base,
      sizing,
      sizeText: sizeText(sizing.qty, ctx.contract),
      leverageText:
        sizing.impliedLeverage !== null && sizing.maxLeverage !== null ? `${sizing.impliedLeverage.toFixed(1)}x of ${sizing.maxLeverage}x` : null,
      amber: sizing.utilisation !== null && sizing.utilisation > MARGIN_AMBER_UTILISATION,
      problem: sizing.refusalMessage,
    };
  } catch (err) {
    return { ...base, sizing: null, sizeText: null, leverageText: null, amber: false, problem: err instanceof Error ? err.message : String(err) };
  }
}

/** The qty on the venue step in its unit, and FX's lots: "20,000 EUR (0.20 lots)". Without a contract: 6 significant digits. */
export function sizeText(qty: number, contract: ContractSpec | null): string {
  if (!contract) return qty.toPrecision(6);
  const decimals = stepDecimals(contract.qtyStep);
  const amount = qty.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const lots = contract.displayLot ? ` (${(qty / contract.displayLot).toFixed(2)} lots)` : '';
  return `${amount} ${contract.unit}${lots}`;
}

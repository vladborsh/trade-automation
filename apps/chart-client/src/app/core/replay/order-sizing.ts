import type { ContractSpec } from '@trade-automation/contracts';
import {
  type AccountMargin,
  type PlacementRefusal,
  insufficientMarginMessage,
  marginRequired as marginAt,
  notional as notionalAt,
  placementCheck,
  positionSize,
  sizeBelowMinimumMessage,
} from '@trade-automation/replay-core';

/** Above this share of equity in margin (after the order) the popup turns amber (design §6, D12). */
export const MARGIN_AMBER_UTILISATION = 0.8;

export interface OrderSizing {
  /** The planned entry: the limit, or the last close for a market order. */
  entry: number;
  qty: number;
  /** 1R actually at risk after rounding to the venue step. */
  riskAmount: number;
  /** 1R as a % of the balance — the risk % the order really takes (≤ the requested one). */
  effectiveRiskPct: number;
  notional: number;
  /** Null without a contract (no margin model for it) — the server refuses such an instrument anyway. */
  marginRequired: number | null;
  /** Free margin once this order is placed; null without a contract or an account. */
  availableAfter: number | null;
  /** This order's notional against equity ("12.3x of 20x"); null without an account. */
  impliedLeverage: number | null;
  maxLeverage: number | null;
  /** Used margin after placing ÷ equity; null without an account or a positive equity. */
  utilisation: number | null;
  refusal: PlacementRefusal | null;
  /** The server's own wording of the refusal (replay-core's messages). */
  refusalMessage: string | null;
}

export interface SizingInput {
  mode: 'market' | 'limit';
  /** The draft's entry (used for a limit). */
  entry: number;
  sl: number;
  lastClose: number;
  balance: number;
  riskPct: number;
  contract: ContractSpec | null;
  /** The session account at the cursor (replay-core `accountMargin`), or null when it cannot be marked. */
  account: AccountMargin | null;
  currency: string;
}

/**
 * T-054 — an order's size and D12 checks, exactly as the server computes them at placement
 * (design §6 "Contract, sizing and margin"): replay-core's `positionSize` rounded down to the venue
 * step, the notional and initial margin at the planned entry, then `placementCheck` —
 * `SIZE_BELOW_MINIMUM`, then `INSUFFICIENT_MARGIN` — with the server's messages. Shared by the order
 * popup and the place check, so a refusal is known before any request. Throws replay-core's
 * `RangeError` when the order cannot be sized at all (a stop at the entry, a non-positive balance).
 */
export function sizeOrder(input: SizingInput): OrderSizing {
  const { contract, account } = input;
  const entry = input.mode === 'market' ? input.lastClose : input.entry;
  const distance = Math.abs(entry - input.sl);
  const { qty, riskAmount } = positionSize(input.balance, input.riskPct, entry, input.sl, contract ?? undefined);
  const notional = contract ? notionalAt(qty, entry, contract) : qty * entry;
  const margin = contract ? marginAt(qty, entry, contract) : null;
  const equity = account?.equity ?? null;
  const base: OrderSizing = {
    entry,
    qty,
    riskAmount,
    effectiveRiskPct: (riskAmount / input.balance) * 100,
    notional,
    marginRequired: margin,
    availableAfter: margin !== null && account ? account.available - margin : null,
    impliedLeverage: equity !== null && equity > 0 ? notional / equity : null,
    maxLeverage: contract?.maxLeverage ?? null,
    utilisation: margin !== null && account && equity !== null && equity > 0 ? (account.usedMargin + margin) / equity : null,
    refusal: null,
    refusalMessage: null,
  };
  if (!contract) return base;
  const refusal = placementCheck({
    qty,
    notional,
    contract,
    marginRequired: margin as number,
    // without an account the margin half cannot be judged here; the server still checks it
    available: account ? account.available : Number.POSITIVE_INFINITY,
  });
  if (refusal === 'SIZE_BELOW_MINIMUM') {
    return { ...base, refusal, refusalMessage: sizeBelowMinimumMessage(contract, entry, distance, input.balance) };
  }
  if (refusal === 'INSUFFICIENT_MARGIN') {
    return { ...base, refusal, refusalMessage: insufficientMarginMessage(margin as number, account!.available, input.currency) };
  }
  return base;
}

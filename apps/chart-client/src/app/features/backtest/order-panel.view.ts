import { positionSize } from '@trade-automation/replay-core';
import type { PositionToolState } from '../chart/overlay/position-tool.model';
import { rMultiple } from '../chart/overlay/position-tool.geometry';

export interface OrderPanelView {
  side: PositionToolState['side'];
  mode: PositionToolState['mode'];
  entry: number;
  qty: number | null;
  riskAmount: number | null;
  rMultiple: number | null;
  notional: number | null;
  /** `qty × entry > balance × notionalWarnMultiple` (decision 25, §6). */
  notionalWarning: boolean;
  /** Why no size can be shown (a stop at the entry, a non-positive balance…). */
  problem: string | null;
}

/**
 * T-023 — what the order panel shows for the active draft: the size replay-core's `positionSize`
 * gives at the balance and risk %, the amount risked (1R), the reward multiple, the notional and the
 * notional warning. The entry is the last close for a market draft (what it fills at).
 */
export function orderPanelView(
  draft: PositionToolState,
  ctx: { balance: number; riskPct: number; lastClose: number; notionalWarnMultiple: number },
): OrderPanelView {
  const entry = draft.mode === 'market' ? ctx.lastClose : draft.entry;
  const base = { side: draft.side, mode: draft.mode, entry, rMultiple: rMultiple({ entry, sl: draft.sl, tp: draft.tp }) };
  try {
    const { qty, riskAmount } = positionSize(ctx.balance, ctx.riskPct, entry, draft.sl);
    const notional = qty * entry;
    return { ...base, qty, riskAmount, notional, notionalWarning: notional > ctx.balance * ctx.notionalWarnMultiple, problem: null };
  } catch (err) {
    return { ...base, qty: null, riskAmount: null, notional: null, notionalWarning: false, problem: err instanceof Error ? err.message : String(err) };
  }
}

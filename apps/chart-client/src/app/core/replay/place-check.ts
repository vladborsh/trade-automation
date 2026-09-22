import { BACKTEST_BOUNDS, type ContractSpec } from '@trade-automation/contracts';
import { type AccountMargin, isStopTooClose } from '@trade-automation/replay-core';
import { sizeOrder } from './order-sizing';
import type { PositionToolState } from '../../features/chart/overlay/position-tool.model';
import type { MutationInput } from './mutation-rules';

export interface PlaceContext {
  panelId: string;
  /** The client cursor when Enter was pressed; the queue sends it after the advances before it. */
  cursorMs: number;
  /** The last revealed 1m close on the draft's panel (what the server fills a market order at). */
  lastClose: number;
  riskPct: number;
  balance: number;
  /** T-054: the instrument's venue contract; with it the D12 refusals are checked before sending. */
  contract?: ContractSpec | null;
  /** T-054: the session account at the cursor, for the margin check (null: left to the server). */
  account?: AccountMargin | null;
  currency?: string;
}

/**
 * T-023 — the `place` request for an active draft, or the reason it would be refused. The checks
 * are the server's own (§7.2, BUG-002/003) so a 422 is rare, in the server's order: the contract
 * bounds, the limit's side of the **current** last close (it may have moved since the draft was
 * drawn), the stop at/too close to the entry (`isStopTooClose`), the stop's side, the target's
 * side, a positive balance, then (T-054, with a contract) D12's venue minimum and margin, with the
 * server's messages (`sizeOrder`). The server stays the authority: a 422 it still sends becomes a hint.
 */
export function buildPlaceRequest(draft: PositionToolState, ctx: PlaceContext): { input: MutationInput } | { hint: string } {
  const B = BACKTEST_BOUNDS;
  const long = draft.side === 'long';
  const market = draft.mode === 'market';
  const entry = market ? ctx.lastClose : draft.entry;
  if (!(ctx.riskPct >= B.riskPctMin && ctx.riskPct <= B.riskPctMax)) return { hint: `Risk % must be between ${B.riskPctMin} and ${B.riskPctMax}.` };
  const levels = [draft.sl, ...(market ? [] : [draft.entry]), ...(draft.tp === null ? [] : [draft.tp])];
  if (levels.some((p) => !(p > 0 && p < B.moneyMaxExclusive))) return { hint: 'A price level is out of range.' };
  if (!market && (long ? draft.entry >= ctx.lastClose : draft.entry <= ctx.lastClose)) {
    return { hint: `The limit is no longer ${long ? 'below' : 'above'} the last close — drag it, or make it a market order.` };
  }
  if (draft.sl === entry || isStopTooClose(entry, draft.sl)) return { hint: 'The stop is too close to the entry to size this order.' };
  if (long ? draft.sl > entry : draft.sl < entry) return { hint: `A ${draft.side} stop must be ${long ? 'below' : 'above'} the entry.` };
  if (draft.tp !== null && (long ? draft.tp <= entry : draft.tp >= entry)) return { hint: `A ${draft.side} target must be ${long ? 'above' : 'below'} the entry.` };
  if (!(ctx.balance > 0)) return { hint: 'The balance is not positive; the order cannot be sized.' };
  if (ctx.contract) {
    const sized = sizeOrder({ mode: draft.mode, entry: draft.entry, sl: draft.sl, lastClose: ctx.lastClose, balance: ctx.balance, riskPct: ctx.riskPct, contract: ctx.contract, account: ctx.account ?? null, currency: ctx.currency ?? '' });
    if (sized.refusalMessage) return { hint: sized.refusalMessage };
  }
  return {
    input: {
      kind: 'place',
      cursorMs: ctx.cursorMs,
      panelId: ctx.panelId,
      side: draft.side,
      type: draft.mode,
      ...(market ? {} : { limitPrice: draft.entry }),
      sl: draft.sl,
      ...(draft.tp === null ? {} : { tp: draft.tp }),
      riskPct: ctx.riskPct,
    },
  };
}

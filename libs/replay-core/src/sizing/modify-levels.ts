import type { OrderSide } from '@trade-automation/contracts';
import { isStopTooClose } from './sizing';

/** The refusals a stop/target move can get (§7.2 PATCH …/orders/:orderId, decision 23). */
export type ModifyLevelError = 'STOP_DISTANCE_ZERO' | 'SL_ON_WRONG_SIDE' | 'TP_ON_WRONG_SIDE';

/** What a move is checked against: the order's side, whether it has filled, and its limit level. */
export interface ModifiableOrder {
  side: OrderSide;
  status: 'pending' | 'open';
  limitPrice: number | null;
}

/**
 * T-033 (Tech Lead ruling, an interpretation of design §7.2 "the wrong-side checks apply"): the
 * level a moved stop or target is checked against.
 *
 * - **pending** — the limit, exactly as at placement: the order will fill there.
 * - **open** — the last revealed 1m close. Size and risk were fixed at placement, so the entry no
 *   longer matters here; what matters is that the new level is not already through the market.
 *   Break-even and a trailing stop into profit are accepted whenever the market is beyond them.
 */
export function modifyReference(order: ModifiableOrder, lastClose: number): number {
  return order.status === 'pending' ? (order.limitPrice as number) : lastClose;
}

/**
 * Checks the levels a move sets (an absent level is not moved and not checked), in the placement
 * order, first failure wins:
 *
 * 1. `STOP_DISTANCE_ZERO` — the stop equals the reference;
 * 2. `SL_ON_WRONG_SIDE` — a long stop above the reference, a short stop below;
 * 3. `STOP_DISTANCE_ZERO` — the stop closer than the minimum distance (`isStopTooClose`);
 * 4. `TP_ON_WRONG_SIDE` — a long target at or below the reference, a short at or above.
 *
 * The server refuses with 422 and the code; the client's SL/TP handles apply the same rule before
 * sending, so a drag into the market is a hint, never a request.
 */
export function modifyLevelError(
  order: ModifiableOrder,
  levels: { sl?: number; tp?: number },
  lastClose: number,
): ModifyLevelError | null {
  const ref = modifyReference(order, lastClose);
  const long = order.side === 'long';
  if (levels.sl !== undefined) {
    if (levels.sl === ref) return 'STOP_DISTANCE_ZERO';
    if (long ? levels.sl > ref : levels.sl < ref) return 'SL_ON_WRONG_SIDE';
    if (isStopTooClose(ref, levels.sl)) return 'STOP_DISTANCE_ZERO';
  }
  if (levels.tp !== undefined && (long ? levels.tp <= ref : levels.tp >= ref)) return 'TP_ON_WRONG_SIDE';
  return null;
}

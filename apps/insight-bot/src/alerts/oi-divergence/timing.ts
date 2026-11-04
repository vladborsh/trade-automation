/**
 * IB-112 (architecture/oi-divergence-design-2026-11-04.md V9, V10) — when the alert loop evaluates,
 * and which confirmed divergences it may still SEND. Pure: seconds in, a decision out.
 *
 * - **Evaluate at bar close + 6 min** (V9): the 5 m OI reading labelled at the close is served about
 *   15–37 s after its moment (dev-1's probe, IB-109), and the poller's next pass lands ~20 s after
 *   the slot; six minutes covers that pass with margin.
 * - **Stale = late** (V10): a pair confirmed more than one TF bar + 10 min before the evaluation was
 *   missed (the box was down, the loop fell behind). It is journalled with `late = true` and never
 *   sent: an alert about a bar that closed long ago is news nobody can act on.
 */

/** The delay after a bar's close before the loop evaluates it. */
export const EVALUATE_AFTER_CLOSE_SEC = 6 * 60;

/** How much older than one bar a confirmation may be and still be sent. */
export const LATE_GRACE_SEC = 10 * 60;

/** The latest bar close whose evaluation is due at `nowSec` (close + 6 min ≤ now), for a TF of `tfSec`. */
export function dueBarClose(nowSec: number, tfSec: number): number {
  return Math.floor((nowSec - EVALUATE_AFTER_CLOSE_SEC) / tfSec) * tfSec;
}

/** When the evaluation after `nowSec` falls: the next bar close + 6 min strictly after now. */
export function nextEvaluationAt(nowSec: number, tfSec: number): number {
  return dueBarClose(nowSec, tfSec) + tfSec + EVALUATE_AFTER_CLOSE_SEC;
}

/**
 * V10: `late` when the pair was confirmed MORE than one bar + 10 min before the evaluation. Exactly
 * at the limit is still on time. A confirmation stamped after the evaluation (clock skew) is not late.
 */
export function isLate(confirmedAtSec: number, evaluatedAtSec: number, tfSec: number): boolean {
  return evaluatedAtSec - confirmedAtSec > tfSec + LATE_GRACE_SEC;
}

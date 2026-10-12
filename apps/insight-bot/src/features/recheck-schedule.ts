import type { WebFrameTimeframe } from '@trade-automation/contracts';
import { attemptOffsetsMs } from './frame-assembly';

/**
 * IB-015 — when the pass looks, as data rather than as a scheduler.
 *
 * §8.1: a frame is computed at the 15m and 4h close plus a 15 s grace, and if the closing bucket
 * was incomplete the pass looks again at +30 s and +60 s. That is four instants per hour for 15m
 * and three more per 4 h bar, and getting the arithmetic right matters more than it looks:
 * a boundary computed from `Date.now()` drifts, and a boundary computed from the previous
 * boundary accumulates the drift.
 *
 * So every instant here is derived from the epoch, never from the last tick — the same rule
 * `src/derive/bucket.ts` follows for buckets, for the same reason.
 */

export const TIMEFRAME_MS: Readonly<Record<WebFrameTimeframe, number>> = {
  '15m': 15 * 60_000,
  '4h': 4 * 3_600_000,
};

export const FRAME_TIMEFRAMES: readonly WebFrameTimeframe[] = ['15m', '4h'];

export interface Attempt {
  tf: WebFrameTimeframe;
  /** The bar's close. The frame is stamped by this, never by the wall clock. */
  closeMs: number;
  /** 0 is the grace look; 1 and 2 are the re-checks. */
  attempt: number;
  /** When the pass should run it. */
  atMs: number;
}

/** The close of the most recent completed bar of `tf` at or before `atMs`. */
export function lastCloseMs(tf: WebFrameTimeframe, atMs: number): number {
  const span = TIMEFRAME_MS[tf];
  return Math.floor(atMs / span) * span;
}

/**
 * Every attempt instant for one bar close.
 *
 * A 4 h close is also a 15m close, and both produce a frame — they are different rows with
 * different `tf`, not a duplicate. §8.2's keys are the same set; what differs is the bar the
 * frame is stamped with and therefore what a signal armed on it refers to.
 */
export function attemptsForClose(tf: WebFrameTimeframe, closeMs: number): Attempt[] {
  return attemptOffsetsMs().map((offset, attempt) => ({ tf, closeMs, attempt, atMs: closeMs + offset }));
}

/**
 * The next attempt due strictly after `afterMs`, across both timeframes.
 *
 * Returns the earliest; ties break towards the longer timeframe so a 4 h frame is not left
 * waiting behind a 15m one it shares an instant with. (They share every 4 h boundary.)
 */
export function nextAttempt(afterMs: number): Attempt {
  const candidates: Attempt[] = [];
  for (const tf of FRAME_TIMEFRAMES) {
    const span = TIMEFRAME_MS[tf];
    // Look at the current bar and the next one: an attempt for the bar that closed a moment ago
    // may still be in the future, and the next bar's grace certainly is.
    const base = lastCloseMs(tf, afterMs);
    for (const closeMs of [base - span, base, base + span]) {
      for (const attempt of attemptsForClose(tf, closeMs)) {
        if (attempt.atMs > afterMs) candidates.push(attempt);
      }
    }
  }
  candidates.sort((a, b) => a.atMs - b.atMs || TIMEFRAME_MS[b.tf] - TIMEFRAME_MS[a.tf]);
  // There is always one: the next bar's grace is always in the future.
  return candidates[0] as Attempt;
}

/**
 * Is this attempt still worth running, given when the pass actually woke?
 *
 * A process that was asleep, paused or starved can wake past an attempt's instant. Running it
 * late is usually right — a frame late is better than no frame, which is IB-BUG-010's lesson —
 * but running the +15 s grace half an hour after the close is not the grace any more, and the
 * frame it writes would be stamped as though it were.
 *
 * The bound is the bar's own span: inside it the frame is still the current bar's, and past it
 * the next bar has already closed and has its own.
 */
export function isAttemptStillDue(attempt: Attempt, nowMs: number): boolean {
  return nowMs < attempt.closeMs + TIMEFRAME_MS[attempt.tf];
}

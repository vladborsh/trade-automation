import { LIQ_MERGE_RATIO, LIQ_MERGE_SEC, LIQ_SMALL_MULT } from '@trade-automation/contracts';

/**
 * IB-148 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §2b, L16–L18) — a lone small crossing next to
 * a large event of the same liquidated side, as pure decisions. The loop (liq-alert-loop.ts) feeds them what the
 * journal and this tick's grouping already hold; nothing here reads or writes.
 *
 * - **Small** (known at the event's own S): one member, its sum < 3 × its own threshold.
 * - **Takes it:** another event's `totalUsd` ≥ 10 × the small one's sum — at the other event's close when it came
 *   before (L17), at its S when it comes after (L18).
 * - **Window:** 120 s, inclusive, both ways. Long and short never meet here: the loop asks per side.
 */
export const MERGE_MS = LIQ_MERGE_SEC * 1_000;

/** L16: one member whose sum at S is below LIQ_SMALL_MULT × its own threshold. */
export function isSmall(coins: ReadonlyArray<{ sumUsd: number; thresholdUsd: number }>): boolean {
  const [only] = coins;
  return coins.length === 1 && only !== undefined && only.sumUsd < LIQ_SMALL_MULT * only.thresholdUsd;
}

/** L16: an event of this size is large enough to take in a small one of `smallUsd`. */
export function takes(totalUsd: number, smallUsd: number): boolean {
  return totalUsd >= LIQ_MERGE_RATIO * smallUsd;
}

/** A same-side event that has closed and was itself sent (not taken in by another). */
export interface ClosedEvent { t0: number; closeAt: number; totalUsd: number }

/**
 * L17: the closed event a small one opening at `t0` is absorbed into — closed at most 120 s before `t0`
 * (inclusive) and large enough at its close. The latest such close wins. Null: not absorbed.
 */
export function absorbedAfter(t0: number, smallUsd: number, closed: readonly ClosedEvent[]): ClosedEvent | null {
  let best: ClosedEvent | null = null;
  for (const c of closed) {
    if (c.t0 >= t0 || c.closeAt > t0 || t0 - c.closeAt > MERGE_MS || !takes(c.totalUsd, smallUsd)) continue;
    if (!best || c.closeAt > best.closeAt) best = c;
  }
  return best;
}

/** The first same-side event opening during a small one's hold, as the loop knows it this tick. */
export interface FollowingEvent {
  t0: number;
  /** Its S, or null while not reached. */
  sAt: number | null;
  /** Its total at S (null while S is not reached). */
  totalUsd: number | null;
  /** Its first message is already journalled (it can no longer carry the line). */
  written: boolean;
}

export type HoldDecision =
  | { kind: 'wait' }
  /** Send the small event's own message; `dueAt` is when it was due (the hold's end, or the next event's S). */
  | { kind: 'send'; dueAt: number }
  /** Fold it into the next event's first message (L18, L19). */
  | { kind: 'fold'; into: number };

/** L18: the events that open during the hold of a small event settled at `sAt`: T0 in (S, S + 120 s]. */
export function opensDuringHold(sAt: number, t0: number): boolean {
  return t0 > sAt && t0 <= sAt + MERGE_MS;
}

/**
 * L18: a small event settled at `sAt`, at `nowMs`. `next` is the first same-side event opening during its hold, or
 * null when none has (yet).
 * - nothing opened: wait until S + 120 s, then send;
 * - something opened: wait for its first message; fold in when it is large enough, else send just before it.
 */
export function holdDecision(sAt: number, smallUsd: number, next: FollowingEvent | null, nowMs: number): HoldDecision {
  if (next === null) return nowMs >= sAt + MERGE_MS ? { kind: 'send', dueAt: sAt + MERGE_MS } : { kind: 'wait' };
  if (next.sAt === null) return { kind: 'wait' };
  if (!next.written && next.totalUsd !== null && takes(next.totalUsd, smallUsd)) return { kind: 'fold', into: next.t0 };
  return { kind: 'send', dueAt: next.sAt };
}

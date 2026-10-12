import type { WebFeatureFrame, WebFeatureKey, WebFeatureValue } from '@trade-automation/contracts';

/**
 * IB-015 — what a re-check is allowed to do to an already-published frame (§8.1's recompute, with
 * the Tech Lead's four rules of 2026-10-12).
 *
 * Pure, because this is where the audit trail is easiest to destroy and easiest to test.
 *
 * 1. A re-check may only turn **not computable → value**. Never value → different value.
 * 2. A would-be change to a published value is a **data defect**, recorded and counted, never
 *    applied. An input that moved under us is a finding about the collectors.
 * 3. An amendment **states itself**: a new revision, when, and which keys moved — whether they
 *    moved to a value or from a chaseable refusal to a permanent one.
 * 4. Identical values write **NOTHING**. Without this, "append-only" becomes "grows for ever" —
 *    a duplicate revision every thirty minutes satisfies the letter and destroys the property.
 */

export interface ValueConflict {
  key: WebFeatureKey;
  published: WebFeatureValue;
  recomputed: WebFeatureValue;
}

export type AmendmentDecision =
  /** Nothing moved. Write nothing at all — not a row, not a revision. */
  | { action: 'none'; conflicts: ValueConflict[] }
  /** At least one refusal became a value. Write revision n+1 naming the keys that moved. */
  | { action: 'amend'; revision: number; amendedKeys: WebFeatureKey[]; keys: Record<string, WebFeatureValue>; conflicts: ValueConflict[] };

/** Two values are the same measurement, compared structurally rather than by reference. */
function sameValue(a: WebFeatureValue, b: WebFeatureValue): boolean {
  if (a.ok !== b.ok) return false;
  if (!a.ok || !b.ok) return !a.ok && !b.ok && a.why === b.why;
  return JSON.stringify(a.value) === JSON.stringify(b.value);
}

/**
 * Decides what a re-check does to a published frame.
 *
 * **Conflicts are returned whether or not an amendment happens**, because a defect does not stop
 * being a defect just because nothing else moved — and the published value is kept in either
 * case. The caller records them and counts them; it does not apply them.
 */
export function decideAmendment(
  published: WebFeatureFrame,
  recomputed: Readonly<Record<string, WebFeatureValue>>,
): AmendmentDecision {
  const amendedKeys: WebFeatureKey[] = [];
  const conflicts: ValueConflict[] = [];
  const keys: Record<string, WebFeatureValue> = { ...published.keys };

  for (const [key, next] of Object.entries(recomputed)) {
    const current = published.keys[key];
    if (current === undefined || next === undefined) continue;
    if (sameValue(current, next)) continue;

    if (!current.ok && next.ok) {
      // rule 1: the only permitted transition
      keys[key] = next;
      amendedKeys.push(key as WebFeatureKey);
      continue;
    }

    if (!current.ok && !next.ok) {
      // A refusal whose REASON moved.
      //
      // Usually neither an amendment nor a defect: nothing a consumer could act on changed, and
      // writing a revision for it would grow the table without moving the answer.
      //
      // **One exception, and it is not cosmetic: leaving `incomplete_input`.** That reason is
      // not just a label, it is an entry in the unhealed-gap counter — `symbolsAwaitingHeal`
      // and `frameCounts` both select on exactly this string — and it promises that somebody
      // can still fix the key. When the bucket heals and the key turns out to refuse for its
      // own reason instead, the promise is no longer true, and leaving it means the counter
      // never drains and the alarm can never be cleared.
      //
      // Found by an integration spec on 2026-10-12: after a heal, `symbolsAwaitingHeal` kept
      // returning the same symbol for ever, because every later re-check re-read a stale
      // `incomplete_input` that the original rule had refused to overwrite.
      //
      // The condition is `incomplete_input` specifically rather than "chaseable -> permanent",
      // because that is precisely what the counter reads. A first attempt used the permanent
      // set and got two cases wrong in opposite directions: `no_data` is not in that set, so
      // leaving `incomplete_input` for it would not have amended, while `no_data ->
      // insufficient_history` — which no counter cares about — would have.
      //
      // This does not weaken the Tech Lead's rule 1. No published VALUE changes and nothing
      // that armed on this frame is rewritten: the key was refused before and is refused after,
      // so `canArm` answers the same either way. What changes is only whether anyone should
      // keep waiting. The transition is one-way, so it cannot oscillate.
      if (current.why === 'incomplete_input' && next.why !== 'incomplete_input') {
        keys[key] = next;
        amendedKeys.push(key as WebFeatureKey);
      }
      continue;
    }

    // Everything else is a defect, and the published value STANDS. That includes value ->
    // different value (an input moved under us) and value -> refusal (an input vanished); in
    // both cases something armed on the published answer and rewriting it would erase the
    // evidence for whatever that was.
    conflicts.push({ key: key as WebFeatureKey, published: current, recomputed: next });
  }

  if (amendedKeys.length === 0) return { action: 'none', conflicts };

  return {
    action: 'amend',
    revision: published.revision + 1,
    // sorted so the same set of movements always produces the same row
    amendedKeys: [...amendedKeys].sort(),
    keys,
    conflicts,
  };
}

/**
 * The amended frame, built from the decision. `complete` is re-derived rather than carried: an
 * amendment that resolves the last refusal makes the frame complete, which is the whole point.
 */
export function applyAmendment(
  published: WebFeatureFrame,
  decision: Extract<AmendmentDecision, { action: 'amend' }>,
  amendedAtSec: number,
  remainingReasons: readonly string[],
  /**
   * The mode of the pass writing THIS revision, which is not necessarily the published one's.
   *
   * A backfill run amending a live frame writes a `backfill` revision, and that is the whole
   * point of recording the mode per revision: the amended answer is informed by healing that
   * had not happened at the close, so revision 1 stays the live record and revision 2 is
   * honestly marked as better informed.
   */
  computedMode: 'live' | 'backfill',
): WebFeatureFrame {
  const complete = Object.values(decision.keys).every((value) => value.ok);
  return {
    ...published,
    keys: decision.keys,
    complete,
    incompleteReason: complete ? [] : [...remainingReasons].sort(),
    revision: decision.revision,
    amendedAt: amendedAtSec,
    amendedKeys: decision.amendedKeys,
    computedMode,
    computedAt: amendedAtSec,
  };
}

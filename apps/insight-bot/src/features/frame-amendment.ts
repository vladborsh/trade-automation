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
 * 3. An amendment **states itself**: a new revision, when, and which keys moved.
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
      // A refusal whose REASON moved — typically `incomplete_input` becoming
      // `insufficient_history` as the bucket heals and the real shortage shows through. Neither
      // an amendment nor a defect: nothing a consumer could act on changed, and writing a
      // revision for it would grow the table without moving the answer. The frame keeps the
      // reason it refused with at publication, which is what was true when something read it.
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
  };
}

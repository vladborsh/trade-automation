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

/**
 * Are these the same measurement? Compared SEMANTICALLY, not by serialisation.
 *
 * **It used to be `JSON.stringify(a) === JSON.stringify(b)` and that was a P1** (IB-048, found
 * by dev-1). Postgres `jsonb` does not preserve key order, so a stored `{count, of}` comes back
 * as `{of, count}` and stringifies differently from the freshly computed object while being the
 * same value. Measured: **954 false conflicts in one audit window, ~17,000 a day extrapolated.**
 *
 * It broke both properties this module exists to provide, at once:
 *
 * 1. **Idempotency** — "a re-check producing identical values writes NOTHING" is the rule that
 *    keeps append-only from becoming grows-for-ever. A false conflict is a written revision.
 * 2. **The data-defect signal** — a changed published value is meant to be a rare, countable
 *    finding about the collectors. 17,000 false ones a day buries every real one, which is the
 *    same failure as a guard that cries wolf: people stop reading it.
 *
 * The five-iteration idempotency loop could not see it because its fixtures round-trip through
 * `JSON.stringify` identically — a fixture that cannot reorder is structurally blind to a bug
 * about ordering.
 */
function sameValue(a: WebFeatureValue, b: WebFeatureValue): boolean {
  if (a.ok !== b.ok) return false;
  if (!a.ok || !b.ok) return !a.ok && !b.ok && a.why === b.why;
  return deepEqual(a.value, b.value);
}

/**
 * Order-insensitive structural equality, for values that have been through `jsonb`.
 *
 * Deliberately NOT "canonicalise then stringify": that would still compare two strings, and the
 * next value shape that serialises ambiguously would reintroduce the bug somewhere else. This
 * compares the values.
 *
 * Arrays stay ORDER-SENSITIVE — `[1,2]` and `[2,1]` are different measurements, and jsonb
 * preserves array order, so there is nothing to be insensitive to. Only object keys reorder.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // NaN is not a measurement anyone should publish, but if two of them meet they are the same
  // non-answer; `===` says otherwise and would mint a conflict on every re-check.
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
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

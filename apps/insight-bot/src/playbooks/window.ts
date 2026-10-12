/**
 * IB-017 — was the armed window continuously evaluated?
 *
 * Pure. An ARMED setup is a **claim about a continuous window**: "in each of the closes since I
 * armed, the trigger did not fire." If some of those closes were never evaluated, we never
 * observed that, and two things go wrong — we assert something we did not see, and a trigger
 * found after the hole is stamped with the wrong bar and therefore the wrong price.
 *
 * **What counts as "evaluated" is a recorded fact, not a reconstruction.** The check reads the
 * `playbook_evaluations` rows this arm actually wrote, rather than re-deriving evaluability from
 * the frames that happen to be stored now. That is the same argument as `computed_mode` one
 * level up: the frames may have healed since, the code may have moved, and a later recomputation
 * is a reconstruction rather than a record of what happened at the time.
 */

/**
 * The closes a timeframe expects strictly after `armedAtMs` and up to and including `nowMs`.
 *
 * Epoch-anchored, like every other bucket boundary in the app, so the set does not shift with
 * when the question is asked.
 */
export function expectedCloses(armedAtMs: number, nowMs: number, tfMs: number): number[] {
  const out: number[] = [];
  if (tfMs <= 0 || nowMs <= armedAtMs) return out;
  const first = Math.floor(armedAtMs / tfMs) * tfMs + tfMs;
  for (let at = first; at <= nowMs; at += tfMs) out.push(at);
  return out;
}

/**
 * Was every expected close actually evaluated?
 *
 * `seen` is the set of closes for which this arm recorded an evaluation it could act on — a
 * close recorded as `blind_while_armed` is NOT seen, because we looked and could not tell.
 *
 * Note the direction of the check: it asks whether every EXPECTED close is present, never
 * whether the counts match. A count comparison passes when one close is missing and an
 * unexpected one is present, which is precisely the case a clock or boundary bug produces.
 */
export function isWindowContiguous(
  expected: readonly number[],
  seen: ReadonlySet<number>,
): boolean {
  for (const close of expected) if (!seen.has(close)) return false;
  return true;
}

/** The closes that are missing, for the reason string on the audit row. */
export function missingCloses(
  expected: readonly number[],
  seen: ReadonlySet<number>,
): number[] {
  return expected.filter((close) => !seen.has(close));
}

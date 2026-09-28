/**
 * IB-015 — whether a feature frame may be computed at all (design §8.1 as amended by §16.10).
 *
 * **This is the refusal path, and it is the part of the feature engine that matters most.** A
 * frame is not a chart: it feeds an arming decision. A chart drawn on a short bar is ugly; a
 * frame computed on a short bar can arm a playbook on a number that was never true.
 *
 * So the rule the Architect ruled (§16.10) is implemented here as a decision, separately from
 * the calculators, and specced as carefully as the happy path:
 *
 * - the pass reads **only** `candles_agg` buckets with `complete = true`;
 * - if the closing bucket, any bucket inside a feature's window, or the OI slot is incomplete
 *   at the grace, it **re-checks at +30 s and +60 s** rather than computing;
 * - still incomplete after that, it writes the frame with `complete = false` and a reason —
 *   it does not compute on short input, and it does not heal the bucket itself (IB-014's heal
 *   pass owns that);
 * - when the bucket later heals, the frame is **recomputed idempotently** on
 *   `(symbol, tf, close_time)`;
 * - **an incomplete frame can never arm or trigger** — that is enforced by `canArm()` here and
 *   asserted by the specs, so a later runner cannot opt out of it by forgetting a check.
 */

/** Why a frame could not be computed on complete input. Stored, so a reader is never guessing. */
export type IncompleteReason =
  /** The bucket at the frame's own close time is short. */
  | 'closing_bucket_incomplete'
  /** A bucket inside some feature's lookback window is short. */
  | 'window_bucket_incomplete'
  /** The 5-minute OI/LS slot at the close is missing. */
  | 'oi_slot_missing'
  /** The series has no bucket at the close time at all — nothing was derived yet. */
  | 'closing_bucket_missing';

export interface BucketState {
  /** Epoch ms of the bucket's open time. */
  openTime: number;
  complete: boolean;
}

export interface CompletenessInput {
  /** The frame's close time, epoch ms — the open time of the bucket that just closed. */
  closeTime: number;
  /** Buckets covering the widest feature window, including the closing one. */
  buckets: readonly BucketState[];
  /** Whether the 5-minute OI slot at the close exists. */
  oiSlotPresent: boolean;
}

export type Completeness =
  | { complete: true }
  | { complete: false; reason: IncompleteReason; incompleteAt: number[] };

/**
 * The decision. Pure, so the retry schedule and the service can be tested apart from it.
 *
 * Order matters: the closing bucket is reported before a window bucket, because "the bar that
 * just closed is short" and "a bar three hours ago is short" need different responses from a
 * reader, and reporting the older one first hides the live problem.
 */
export function assessCompleteness(input: CompletenessInput): Completeness {
  const closing = input.buckets.find((b) => b.openTime === input.closeTime);
  if (!closing) {
    return { complete: false, reason: 'closing_bucket_missing', incompleteAt: [input.closeTime] };
  }
  if (!closing.complete) {
    return { complete: false, reason: 'closing_bucket_incomplete', incompleteAt: [input.closeTime] };
  }

  const shortWindow = input.buckets.filter((b) => !b.complete).map((b) => b.openTime).sort((a, b) => a - b);
  if (shortWindow.length > 0) {
    return { complete: false, reason: 'window_bucket_incomplete', incompleteAt: shortWindow };
  }

  // the OI slot is checked last: it is the only input that is not a candle bucket, and a
  // missing slot is a different repair from a short bar
  if (!input.oiSlotPresent) {
    return { complete: false, reason: 'oi_slot_missing', incompleteAt: [input.closeTime] };
  }
  return { complete: true };
}

/**
 * §16.10, stated as code so nothing downstream has to remember it: **an incomplete frame can
 * never arm or trigger a playbook.** IB-017's runner asks this, rather than reading `complete`
 * and deciding for itself.
 */
export function canArm(frame: { complete: boolean }): boolean {
  return frame.complete;
}

/** §8.1's grace, and §16.10's two re-checks, as offsets from the bucket's close. */
export const GRACE_MS = 15_000;
export const RECHECK_OFFSETS_MS = [30_000, 60_000] as const;

/**
 * When to look again, given the close time — the grace, then +30 s, then +60 s. After the last
 * one the pass writes `complete = false` and stops; it never spins waiting for a heal, because
 * the heal pass will trigger a recompute when it lands.
 */
export function attemptSchedule(closeTimeMs: number): number[] {
  return [closeTimeMs + GRACE_MS, ...RECHECK_OFFSETS_MS.map((offset) => closeTimeMs + GRACE_MS + offset)];
}

/** True when this attempt is the last one, i.e. the next write is the incomplete frame. */
export function isFinalAttempt(attempt: number): boolean {
  return attempt >= RECHECK_OFFSETS_MS.length;
}

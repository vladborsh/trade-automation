import {
  WEB_FEATURE_KEYS, WEB_FEATURE_SPEC, WEB_FRAME_VERSION,
  type WebFeatureFrame, type WebFeatureKey, type WebFeatureValue, type WebFrameBasis,
  type WebFrameTimeframe,
} from '@trade-automation/contracts';

/**
 * IB-015 — the refusal path and the frame it produces (design §8.1, §16.10).
 *
 * Pure, because this is the rule the whole task exists to get right: **a frame computed on an
 * unhealed bucket must not be able to arm anything.** A rule enforced inside a service that also
 * talks to Postgres and a clock is a rule that is tested by integration or not at all.
 *
 * The shape of the refusal, decided with the Tech Lead on 2026-10-12:
 *
 * - the frame IS written, never skipped — a missing frame is indistinguishable from "the feature
 *   pass was not running", which is IB-BUG-010 one layer up;
 * - a key whose input group was incomplete refuses with `incomplete_input`, and **the refusal
 *   beats a computed value**: if a calculator produced a number from a short bucket, that number
 *   is discarded here rather than published;
 * - every other key keeps its value, because a valid open-interest delta is not worth throwing
 *   away over an incomplete funding bucket;
 * - `complete` is derived, never passed in, and is an index for finding frames with refusals —
 *   arming is decided per key by the consumer (`canArm`).
 */

export interface AssembleInput {
  symbol: string;
  tf: WebFrameTimeframe;
  /** The bar's close, epoch seconds, UTC. Never a wall clock. */
  closeTimeSec: number;
  /** What the calculators produced. Every registry key must be present — see below. */
  computed: Partial<Record<WebFeatureKey, WebFeatureValue>>;
  /**
   * Input groups that were not reliably complete at this close, e.g. `agg:15m`, `oi`. The
   * service decides membership after §8.1's re-checks at +30 s and +60 s.
   */
  incompleteGroups: ReadonlySet<string>;
  /** Human-readable, one per short bucket or slot: "candles_agg 15m@12:00 bars 14 of 15". */
  reasons: readonly string[];
  basis: WebFrameBasis;
}

/** Keys poisoned by a set of incomplete input groups. */
export function keysBlockedBy(incompleteGroups: ReadonlySet<string>): WebFeatureKey[] {
  if (incompleteGroups.size === 0) return [];
  return WEB_FEATURE_KEYS.filter((key) =>
    WEB_FEATURE_SPEC[key].inputs.some((group) => incompleteGroups.has(group)));
}

/**
 * Builds the frame.
 *
 * **Strict on missing keys, deliberately.** A key the calculators did not produce is a
 * programming error, not absent data, and filling it with `no_data` would publish a refusal that
 * claims something about the market when the truth is that nobody computed it. Throwing keeps
 * that distinction; the alternative is a frame that looks complete in shape and is hollow.
 */
export function assembleFrame(input: AssembleInput): WebFeatureFrame {
  const blocked = new Set<string>(keysBlockedBy(input.incompleteGroups));
  const keys: Record<string, WebFeatureValue> = {};

  for (const key of WEB_FEATURE_KEYS) {
    const computed = input.computed[key];
    if (computed === undefined) {
      throw new Error(
        `assembleFrame: no value produced for "${key}". Every key in the registry must be ` +
        'computed or explicitly refused; a missing key is a bug, not missing data.',
      );
    }
    // the refusal wins: a number computed from a short bucket must not reach a consumer
    keys[key] = blocked.has(key) ? { ok: false, why: 'incomplete_input' } : computed;
  }

  const complete = Object.values(keys).every((value) => value.ok);
  return {
    symbol: input.symbol,
    tf: input.tf,
    closeTime: input.closeTimeSec,
    frameVersion: WEB_FRAME_VERSION,
    keys,
    basis: input.basis,
    complete,
    // sorted so two runs over the same shortfalls produce byte-identical frames
    incompleteReason: complete ? [] : [...input.reasons].sort(),
    // A frame as first written is revision 1 and has amended nothing. Amendments are decided in
    // `frame-amendment.ts`, never here — this function only ever builds the original.
    revision: 1,
    amendedAt: null,
    amendedKeys: [],
  };
}

/**
 * §8.1's re-check schedule: the grace, then two heal ticks.
 *
 * "If the closing bucket … is incomplete at the grace, the pass re-checks at +30 s and +60 s."
 * Expressed as data so the service does not own the policy and the policy can be read without
 * reading a scheduler.
 */
export const FEATURE_GRACE_MS = 15_000;
export const FEATURE_RECHECK_MS: readonly number[] = [30_000, 60_000];

/** Milliseconds after the bar close at which the pass looks, in order. */
export function attemptOffsetsMs(): number[] {
  return [FEATURE_GRACE_MS, ...FEATURE_RECHECK_MS];
}

/**
 * Whether this is the last look. After it, the frame is written with whatever is still short —
 * §8.1 is explicit that the pass does not heal on its own and does not wait for ever.
 */
export function isFinalAttempt(attempt: number): boolean {
  return attempt >= attemptOffsetsMs().length - 1;
}

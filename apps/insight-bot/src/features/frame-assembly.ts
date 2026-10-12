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
   * The KEYS whose own window was not reliably complete at this close — IB-047.
   *
   * Keys, not input groups. A group's keys span 96× inside `agg:15m` (`px.close` needs one bar,
   * `px.ret_24h` ninety-six), so blocking per group made the narrow keys refuse whenever the
   * widest one was short: 422 of 477 `px.*` refusals were that artefact, every one of them
   * indistinguishable from an honest refusal from the outside.
   *
   * The service decides membership after §8.1's re-checks at +30 s and +60 s.
   */
  incompleteKeys: ReadonlySet<string>;
  /**
   * Keys whose window was short by an amount fully accounted for by something that will never
   * change — a
   * recorded `collector_gaps` row, a halt, or minutes before the symbol listed.
   *
   * **They refuse too.** "The venue never produced these minutes" explains WHY the data is
   * missing; it does not make a statistic over half a window correct. A symbol that listed at
   * 02:00 has a fully explained shortfall at the 04:00 4 h close, and its ATR over 120 of 240
   * minutes is not the 4 h ATR — publishing it would be the same confidently-wrong number the
   * incomplete path exists to refuse.
   *
   * They refuse with a DIFFERENT reason, which is the whole point of separating them: an
   * explained absence is permanent and must not be counted as an unhealed gap, or the counter
   * never drains and the alarm stops being read.
   */
  explainedKeys: ReadonlySet<string>;
  /** Human-readable, one per short bucket or slot: "candles_agg 15m@12:00 bars 14 of 15". */
  reasons: readonly string[];
  basis: WebFrameBasis;
  /**
   * Live pass at the close, or a backfill over history. Required rather than defaulted: a
   * default would let a new caller silently inherit `live` and reintroduce exactly the
   * indistinguishability this field exists to remove.
   */
  computedMode: 'live' | 'backfill';
  /** When this revision was computed — the wall clock, not the bar. */
  computedAtSec: number;
}

/** Keys poisoned by a set of incomplete input groups. */
export function keysBlockedBy(incompleteGroups: ReadonlySet<string>): WebFeatureKey[] {
  if (incompleteGroups.size === 0) return [];
  return WEB_FEATURE_KEYS.filter((key) =>
    WEB_FEATURE_SPEC[key].inputs.some((group) => incompleteGroups.has(group)));
}

/** Everything a set of blocked keys covers, filtered to the registry so a typo cannot pass. */
function blockedSet(keys: ReadonlySet<string>): Set<string> {
  return new Set(WEB_FEATURE_KEYS.filter((key) => keys.has(key)));
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
  const blocked = blockedSet(input.incompleteKeys);
  const explained = blockedSet(input.explainedKeys);
  const keys: Record<string, WebFeatureValue> = {};

  for (const key of WEB_FEATURE_KEYS) {
    const computed = input.computed[key];
    if (computed === undefined) {
      throw new Error(
        `assembleFrame: no value produced for "${key}". Every key in the registry must be ` +
        'computed or explicitly refused; a missing key is a bug, not missing data.',
      );
    }
    // The refusal wins: a number computed from a short window must not reach a consumer.
    //
    // `incomplete_input` is checked first because a key reading two groups — one chaseably
    // short, one explained — is chaseable. Resolving it the other way would file a real gap
    // under "permanent, nothing to do" and lose it.
    if (blocked.has(key)) keys[key] = { ok: false, why: 'incomplete_input' };
    else if (explained.has(key)) keys[key] = { ok: false, why: 'explained_absence' };
    else keys[key] = computed;
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
    computedMode: input.computedMode,
    computedAt: input.computedAtSec,
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

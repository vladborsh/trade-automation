import { z } from 'zod';

/**
 * architecture/insight-bot-system-design.md §8.4, D9, D10, D12 — the playbook port, the setup
 * state machine and the twin-arm contract (IB-017).
 *
 * In `libs/contracts` rather than in the app because three readers share it: the engine writes
 * it, the dashboard's signal pages (IB-033) read it, and the stage-3 backtest runner is
 * explicitly *the same function over historical frames*. A shape two of those agree on and the
 * third infers is how they drift.
 *
 * **One thing here contradicts the design text, deliberately.** §8.4 declares
 * `PlaybookInput.frame` as "`complete === true`". That is superseded by the per-key arming rule
 * of 2026-10-12: a playbook names the keys it needs and `canArm` decides, and `complete` is an
 * index for finding frames with refusals, never a gate. Taken literally the old wording is not
 * merely stale but fatal — on the current tape no frame is `complete`, because `atr.1d.14`
 * refuses until the archive backfill exists, so P3 could never arm at all.
 */

/** §8.4. `CLOSED` is reached only when the tracker (IB-023) records an outcome. */
/** Epoch seconds, UTC — the same local shape `feature-frame.ts` uses, kept identical on purpose. */
const TimeSec = z.number().int().nonnegative();

export const SetupStateSchema = z.enum(['IDLE', 'ARMED', 'TRIGGERED', 'CLOSED']);
export type SetupState = z.infer<typeof SetupStateSchema>;

/**
 * D9's two arms.
 *
 * `gated` has the playbook's one declared `context_gate` applied and is the arm that may go
 * live. `unconditional` runs the identical thresholds with no gate and is **always** shadow,
 * whatever `playbook_config.status` says — it exists to measure whether the gate earns its
 * place, and an arm that could be delivered would stop being a control.
 */
export const ArmSchema = z.enum(['gated', 'unconditional']);
export type Arm = z.infer<typeof ArmSchema>;

/**
 * Every way a setup can move. Two of these did not exist in the design text and are the
 * rulings of 2026-10-12.
 *
 * - `expired` — the TTL was reached and every close in the window WAS evaluated. The market did
 *   not oblige. An honest expiry.
 * - `expired_unevaluable` — the TTL was reached and some close in the window was never
 *   evaluated in this arm's own mode. We cannot say the trigger did not fire, so we do not say
 *   it. Counted apart from `expired`, because one is the market and the other is us not looking.
 */
export const SetupTransitionSchema = z.enum([
  'armed', 'triggered', 'invalidated', 'expired', 'expired_unevaluable', 'closed',
]);
export type SetupTransition = z.infer<typeof SetupTransitionSchema>;

/**
 * Why a `context_gate` did not pass — and specifically, why it could not be ANSWERED.
 *
 * §8.3 allows exactly one gate per playbook, over a regime axis or a feature key. Either can be
 * unavailable, and an unavailable observable is **not a pass and not a fail**: it fails closed
 * under its own reason, counted separately, so that a dead collector can never be mistaken for
 * a genuine veto.
 *
 * `calendar_unknown` is the named instance of that rule and is a binding ruling in its own
 * right. Measured on 2026-10-12: `calendar_events` held 256 rows whose last `fetched_at` was
 * 2026-10-07, so a non-emptiness check would have reported CLEAR for nine days — wrong in the
 * only direction that costs money. Rows are not coverage. It is never reported as `EVENT_RISK`,
 * because a veto that fires because nobody is collecting is indistinguishable from a busy news
 * week exactly when the difference matters.
 */
export const GateRefusalSchema = z.enum([
  'calendar_unknown',
  'gate_key_unavailable',
  'gate_axis_unavailable',
]);
export type GateRefusal = z.infer<typeof GateRefusalSchema>;

/**
 * Why the engine declined to produce a decision for an arm at a close.
 *
 * **Every one of these is a refusal to decide, not a decision not to arm**, and they are counted
 * apart from "evaluated and did not arm" for the reason that runs through this whole design: one
 * is a gap in our data and the other is a statement about the market. Summing them would make a
 * fortnight of missing liquidation history look like a fortnight of calm.
 */
export const ArmRefusalSchema = z.enum([
  /** `canArm(frame, armKeys)` was false — the frame cannot answer what the playbook needs. */
  'insufficient_features',
  /**
   * ARMED, and a key the TRIGGER reads is refusing. We are holding a live setup and cannot see
   * whether it fired.
   *
   * Ruled 2026-10-12 to be a reportable state rather than a pause: an arm in this condition must
   * invalidate with a reason or be counted here, never silently wait. "We held a setup and could
   * not see" is the condition under which a user would most want to know the system is impaired.
   */
  'blind_while_armed',
  /** A close in the armed window was never evaluated in this arm's own mode (§3.2's contiguity). */
  'window_not_contiguous',
  /**
   * The trigger fired, we agree it fired, and we noticed too long afterwards to act on it.
   *
   * Ruled 2026-10-12: past a stated bound the two timestamps diverging "is not a signal to
   * send, it is a late detection, refused and counted as one". Unlike its neighbours this is
   * not a gap in the data — the evaluation succeeded — which is why it is counted separately
   * from both a refusal to decide and an ordinary decline. A rising count here means the pass
   * is running late, which is an operational fact about us and not about the market.
   */
  'late_detection',
  /**
   * A sibling arm pinned this close to a frame revision that can no longer be read.
   *
   * The two arms of one close must be evaluated on the same information, so the first arm to
   * touch a close pins its frame revision and any arm evaluated later reads THAT revision —
   * never whatever is newest, which after a heal pass is better informed. Frames are
   * append-only, so the pin is satisfiable whenever it was real; a failure here is a genuine
   * finding about the frames table rather than an expected miss, which is why it refuses
   * loudly instead of substituting the newest revision.
   */
  'frame_revision_unavailable',
]);
export type ArmRefusal = z.infer<typeof ArmRefusalSchema>;

/** One evaluated condition, for the message's conditions table and for the score's share. */
export const PlaybookConditionSchema = z.object({
  key: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),
  threshold: z.union([z.number(), z.string()]),
  pass: z.boolean(),
});
export type PlaybookCondition = z.infer<typeof PlaybookConditionSchema>;

/** The draft's `Setup`, kept (§8.4). Machine-readable throughout: nothing here is prose. */
export const SetupSchema = z.object({
  armId: z.string(),
  direction: z.enum(['long', 'short']),
  trigger: z.object({
    type: z.string(),
    level: z.number(),
    tf: z.enum(['15m', '4h']),
  }),
  stop: z.number(),
  targets: z.array(z.number()),
  /** Machine-readable invalidation rules, so the tracker can evaluate them without parsing text. */
  invalidation: z.array(z.object({
    key: z.string(),
    op: z.enum(['<', '<=', '>', '>=', 'in', 'not_in']),
    value: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]),
  })),
  rr: z.number().nullable(),
  expiresAt: TimeSec,
});
export type Setup = z.infer<typeof SetupSchema>;

/**
 * The gate's verdict on one arm — a THREE-state union, not a boolean with a reason beside it.
 *
 * Aligned with dev-1's `evaluateRegimeGate`, which returns `pass | blocked |
 * gate_axis_unavailable` and deliberately exposes no boolean helper. The reason to match it is
 * the reason it was built that way: with `pass: false` plus a nullable `refusal`, a caller can
 * read the boolean and never look at the field that says the gate could not be answered at all.
 * A union makes that unrepresentable — the same argument as typed refusals over a `complete`
 * flag, one level up.
 *
 * The three states and why they must never be summed:
 *
 * - `pass` — the observable was read and satisfied the gate.
 * - `blocked` — the observable was read and did not. **This is the gate doing its job**, and
 *   D10 says it is tracked, because the veto's own expectancy delta is a query.
 * - `unavailable` — the observable could not be read. This is evidence about our plumbing, not
 *   about the market, and the twin-arm comparison must be able to EXCLUDE these closes
 *   entirely: counted together with `blocked`, a fortnight of our own outage reads as "the gate
 *   costs performance" (ruled 2026-10-12).
 *
 * dev-1's `gate_axis_unavailable` maps to `{ status: 'unavailable', refusal:
 * 'gate_axis_unavailable' }`; the other two refusals cover a feature-key gate and the calendar.
 */
const GateObservable = {
  observable: z.string(),
  op: z.string(),
  value: z.unknown(),
};

export const GateVerdictSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pass'), ...GateObservable, actual: z.unknown() }),
  z.object({ status: z.literal('blocked'), ...GateObservable, actual: z.unknown() }),
  z.object({
    status: z.literal('unavailable'),
    ...GateObservable,
    /** Null by construction: an observable that could not be read has no value. */
    actual: z.null(),
    refusal: GateRefusalSchema,
  }),
]);
export type GateVerdict = z.infer<typeof GateVerdictSchema>;

/**
 * Did the gated arm get a real answer at this close?
 *
 * The predicate the twin-arm comparison filters on: a close where the gate was `unavailable` is
 * not evidence either way and must be dropped from BOTH arms before the two are compared, or
 * the comparison is a number that is right about the wrong population.
 */
export function gateWasAnswered(verdict: GateVerdict): boolean {
  return verdict.status !== 'unavailable';
}

/**
 * When a trigger fired, and when we noticed — two facts, two fields (ruled 2026-10-12).
 *
 * Stamping a trigger with the instant we evaluated it rather than the bar it fired on is the
 * anchor-skew defect from the news path arriving where it costs money instead of a correlation:
 * a 45-minute-old trigger recorded at today's timestamp also implies today's price.
 *
 * `triggerCloseTime` is D12's idempotency anchor, so a replay of the same bar cannot duplicate
 * a signal however late it runs — the key is the BAR, never the moment we got round to it.
 */
export const TriggerTimingSchema = z.object({
  /** The bar close the trigger actually fired at. D12's `trigger_ts`. */
  triggerCloseTime: TimeSec,
  /** When the runner evaluated it. */
  detectedAt: TimeSec,
  /**
   * `detectedAt − triggerCloseTime`, stored rather than derived.
   *
   * Signed and persisted for the same reason the news path persists its skew: a figure that
   * must be recomputed at every call site is a figure that gets recomputed differently. Signed
   * because a negative value is not "early", it is a clock problem, and a field that cannot
   * represent it cannot report it.
   */
  detectionSkewSec: z.number().int(),
});
export type TriggerTiming = z.infer<typeof TriggerTimingSchema>;

/**
 * A playbook's key requirements, split in two — and the split is load-bearing.
 *
 * A refusal in `armKeys` means "cannot arm": ordinary, frequent, and on today's tape the normal
 * state of P3, which needs `liq.*.z60m` and therefore 14 days of liquidation coverage.
 *
 * A refusal in `triggerKeys` while a setup is ARMED is a different and more serious thing: we
 * are holding a live setup and cannot tell whether it fired. That is what makes the armed window
 * unevaluable, and treating the two alike would either throw away every setup over a harmless
 * gap in a key the trigger never reads, or carry one over a gap in a key it does.
 */
export const PlaybookKeyRequirementsSchema = z.object({
  armKeys: z.array(z.string()),
  triggerKeys: z.array(z.string()),
});
export type PlaybookKeyRequirements = z.infer<typeof PlaybookKeyRequirementsSchema>;

/** The transitions that end a setup's life without an outcome. */
export const TERMINAL_WITHOUT_OUTCOME: readonly SetupTransition[] = [
  'invalidated', 'expired', 'expired_unevaluable',
];

/**
 * Did this transition end the setup without anybody learning anything from it?
 *
 * Used to keep the three apart in the counters. `expired_unevaluable` in particular must never
 * be folded into `expired`: a rising count of the first is an operational fault, a rising count
 * of the second is the market.
 */
export function endsWithoutOutcome(transition: SetupTransition): boolean {
  return TERMINAL_WITHOUT_OUTCOME.includes(transition);
}

/**
 * Is this skew past the bound — i.e. a late detection rather than a signal?
 *
 * The bound is a parameter, never a literal here: it is a product decision about how stale a
 * trigger may be and still be worth acting on, and it belongs in `playbook_config.params` where
 * changing it creates a new version.
 */
export function isLateDetection(timing: TriggerTiming, boundSec: number): boolean {
  return timing.detectionSkewSec > boundSec;
}

/**
 * Where a frame came from, carried onto the signal and into D12's uniqueness.
 *
 * Mirrors `WebFeatureFrame.computedMode`, and the consequence of omitting it is worse here than
 * it is for frames. With `(playbook, symbol, trigger_ts, arm)` and no mode, an
 * `on conflict do nothing` silently discards either the live signal or the backtest row for the
 * same close — whichever ran second. A backtest that quietly drops its own rows exactly where
 * live signals already exist would report **better-than-real** performance, and the error would
 * present as a good strategy rather than as a bug.
 */
export const SignalSourceModeSchema = z.enum(['live', 'backtest']);
export type SignalSourceMode = z.infer<typeof SignalSourceModeSchema>;

/**
 * A trigger the §8.5 gate chose not to deliver, recorded rather than dropped.
 *
 * Ruled 2026-10-12. "A valid trigger we chose not to send" is information about the thresholds,
 * and it is the only way anyone learns whether the daily budget is set sensibly — a suppressed
 * trigger that leaves no row makes the budget unfalsifiable.
 */
export const SuppressionSchema = z.object({
  /** `budget_exhausted`, `correlation_collapsed`, `user_limit`, … — IB-020 owns the vocabulary. */
  reason: z.string(),
  at: TimeSec,
});
export type Suppression = z.infer<typeof SuppressionSchema>;

/** `detectedAt − triggerCloseTime`, the one place the subtraction is written. */
export function detectionSkewSec(triggerCloseTime: number, detectedAt: number): number {
  return detectedAt - triggerCloseTime;
}

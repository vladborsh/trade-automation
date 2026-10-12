import type { WebFeatureUnavailable } from '@trade-automation/contracts';
import type { RegimeAxisValue } from './axes';
import type { RegimeContext } from './context';

/**
 * IB-016 → IB-017 — how a `context_gate` reads a regime axis (design §8.3).
 *
 * ===================== WHY THIS IS NOT A BOOLEAN =====================
 *
 * A gate asks "is `regime.trend` in [UP, RANGE]?" and there are **three** answers, not two:
 *
 * - the axis says `DOWN` → the gate does not pass, and that is a **measurement**;
 * - the axis says `UP` → the gate passes;
 * - the axis **refused** → nobody knows, and `gate_axis_unavailable` is the answer.
 *
 * Collapsing the third into the second is the defect this whole system has spent the day removing,
 * arriving at the last mile where it decides whether a member gets a signal. A gate that cannot
 * tell "the market is not trending" from "we could not tell" silently converts missing data into a
 * trading decision — and it does so in the quiet direction, by not firing, which is the direction
 * nobody investigates. Worse, §8.3's whole justification for gates is that their expectancy is
 * *measured* against an unconditional arm; a gate whose non-passes are a mixture of findings and
 * blindness produces a number that cannot be interpreted either way.
 *
 * So `evaluateRegimeGate` returns a three-state result in which the unavailable case is a distinct
 * variant carrying the axis's own reason. There is deliberately no helper that turns it into a
 * boolean: a caller that wants one has to write the collapse itself, in the open, where a reviewer
 * can see which way it decided to fail.
 *
 * **This is the runner's API, not a playbook's.** `playbooks/` must never import `regime/` (§8.3,
 * spec'd in `regime-spec.spec.ts`); the runner evaluates the declared gate and hands the playbook
 * its verdict.
 */

/** The axes a gate may name, as they appear in `playbook_config`. */
export const REGIME_OBSERVABLES = [
  'regime.trend',
  'regime.vol',
  'regime.leverage',
  'regime.crowded_side',
  'regime.event_window',
] as const;
export type RegimeObservable = (typeof REGIME_OBSERVABLES)[number];

/**
 * §8.3 allows `<, ≤, ≥, >, in` for feature keys; the regime axes are **enums**, so `in` is the only
 * operator that means anything on them. An ordering comparison on `UP`/`RANGE`/`DOWN` would invent
 * a rank the design never defined.
 */
export interface RegimeGate {
  observable: RegimeObservable;
  op: 'in';
  value: readonly string[];
}

export type RegimeGateOutcome =
  /** The axis was measured and matches the gate. */
  | { outcome: 'pass'; observed: string }
  /** The axis was measured and does not match — a finding, and the gate did its job. */
  | { outcome: 'blocked'; observed: string }
  /**
   * The axis could not be computed. **Not a non-pass**: it is reported under its own name with the
   * axis's own reason, so IB-017 can count it separately and a long run of it reads as "fix the
   * input", not as "the market was quiet".
   */
  | { outcome: 'gate_axis_unavailable'; observable: RegimeObservable; why: WebFeatureUnavailable };

/** Which field of a context row each observable names. One place, so a new axis cannot be orphaned. */
const AXIS_OF: Record<RegimeObservable, (context: RegimeContext) => RegimeAxisValue<string>> = {
  'regime.trend': (context) => context.trend,
  'regime.vol': (context) => context.vol,
  'regime.leverage': (context) => context.leverage,
  'regime.crowded_side': (context) => context.crowdedSide,
  'regime.event_window': (context) => context.eventWindow,
};

/**
 * Reads one axis by the name a gate uses, keeping its refusal intact.
 *
 * Exposed for readers that are not gates — the debug endpoint, IB-023's tracking — so they do not
 * reach into `RegimeContext` by field name and quietly disagree with the gate about which axis
 * `regime.crowded_side` is.
 */
export function readRegimeAxis(context: RegimeContext, observable: RegimeObservable): RegimeAxisValue<string> {
  return AXIS_OF[observable](context);
}

/**
 * Evaluates a declared `context_gate` against one context row.
 *
 * The comparison is exact string equality against the declared set: the axis values are a closed
 * enum, and a gate naming a value no axis can produce (a typo, or a label from a bumped
 * `REGIME_VERSION`) can only ever be `blocked`, never `pass`. That is the safe direction, and
 * `observed` is on the result so the mismatch is visible in IB-017's tracking rather than being a
 * gate that silently never fires.
 */
export function evaluateRegimeGate(context: RegimeContext, gate: RegimeGate): RegimeGateOutcome {
  const axis = readRegimeAxis(context, gate.observable);
  if (!axis.ok) {
    return { outcome: 'gate_axis_unavailable', observable: gate.observable, why: axis.why };
  }
  return gate.value.includes(axis.value)
    ? { outcome: 'pass', observed: axis.value }
    : { outcome: 'blocked', observed: axis.value };
}

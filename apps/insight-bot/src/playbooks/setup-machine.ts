import {
  type Arm, type ArmRefusal, type GateVerdict, type SetupState, type SetupTransition,
  gateWasAnswered,
} from '@trade-automation/contracts';

/**
 * IB-017 — the setup state machine (§8.4), pure.
 *
 * Pure for the same reason the frame's refusal path is: this decides whether a live setup is
 * carried, killed or allowed to fire, and a rule that lives inside a service which also talks
 * to Postgres and a clock is a rule that is tested by integration or not at all.
 *
 * ```
 *                  ┌──────────────── cooldown lapsed ─────────────────┐
 *                  v                                                  │
 *   IDLE ──arm──> ARMED ──trigger──> TRIGGERED ──outcome (IB-023)──> CLOSED
 *    ^              │
 *    │              ├── invalidated          (the playbook's own rule)
 *    └──────────────┤── expired              (TTL reached, window intact)
 *                   └── expired_unevaluable  (the window has a hole)
 * ```
 *
 * **`TRIGGERED → CLOSED` is not this module's edge.** The tracker (IB-023) owns it, and until
 * IB-023 exists nothing will leave TRIGGERED: the first trigger per `(playbook, symbol, arm)`
 * freezes that pair. There is deliberately no timeout here to paper over that — a timeout would
 * be an invented number, and the stuck count this engine exposes is the measurement that would
 * later justify one. The absence is a decision, not an oversight.
 */

/** What the playbook itself said, before the machine applies the rules around it. */
export interface PlaybookVerdict {
  /** The playbook wants to arm at this close. */
  wantsArm: boolean;
  /** The playbook's trigger condition fired at this close. */
  triggered: boolean;
  /** One of the setup's own `invalidation[]` rules matched. */
  invalidated: boolean;
}

export interface MachineInput {
  arm: Arm;
  prev: SetupState;
  verdict: PlaybookVerdict;
  /**
   * The gate's answer at THIS close. Only consulted on an IDLE → ARMED transition: the context
   * gate is arm-time only (ruled 2026-10-12), because the twin-arm design measures whether the
   * gate adds value and that requires the gated arm to be a clean subset of the unconditional
   * one. A gate that could also kill armed setups would conflate "filtered entries" with
   * "exited early" and make the comparison unattributable.
   *
   * Null when the playbook declares no gate, and always null for the `unconditional` arm.
   */
  gate: GateVerdict | null;
  /** `canArm(frame, armKeys)`. */
  armKeysAvailable: boolean;
  /** `canArm(frame, triggerKeys)`. */
  triggerKeysAvailable: boolean;
  /** The TTL has been reached for the setup currently held. */
  ttlReached: boolean;
  /**
   * Every close between `armed_at` and now was evaluated in THIS arm's own mode.
   *
   * False means a hole: we cannot say the trigger did not already fire, and a trigger found
   * after a hole would be stamped with the wrong bar.
   */
  windowContiguous: boolean;
  /** A cooldown row blocks a new arm for this `(playbook, symbol)`. */
  cooldownActive: boolean;
}

export interface MachineResult {
  state: SetupState;
  transitions: SetupTransition[];
  /**
   * Why the engine declined to DECIDE, as opposed to deciding not to arm.
   *
   * Null on an ordinary "evaluated, did not arm". Never summed with it: one is a gap in our
   * data, the other is a statement about the market.
   */
  refusal: ArmRefusal | null;
  /**
   * True when this close must be excluded from the twin-arm comparison entirely.
   *
   * A close where the gate could not be answered is evidence about our plumbing and nothing
   * about the gate, so counting it as "the gated arm did not arm" would read our own outage as
   * the gate costing performance (ruled 2026-10-12).
   */
  excludeFromComparison: boolean;
}

const result = (
  state: SetupState,
  transitions: SetupTransition[] = [],
  over: Partial<MachineResult> = {},
): MachineResult => ({ state, transitions, refusal: null, excludeFromComparison: false, ...over });

/**
 * One close, one arm. Deterministic and total: every input combination yields a state.
 *
 * The ORDER of the checks below is the design, not an implementation detail, and each one is
 * placed where it is for a reason given inline.
 */
export function step(input: MachineInput): MachineResult {
  switch (input.prev) {
    case 'TRIGGERED':
      // Frozen until IB-023 records an outcome. Reported, never timed out.
      return result('TRIGGERED');

    case 'CLOSED':
      // The setup is done; the pair returns to IDLE once nothing blocks a new arm. The cooldown
      // is checked at the arm attempt below rather than here, so a lapsed cooldown needs no
      // separate sweep to notice it.
      return result(input.cooldownActive ? 'CLOSED' : 'IDLE');

    case 'ARMED':
      return stepArmed(input);

    case 'IDLE':
    default:
      return stepIdle(input);
  }
}

function stepArmed(input: MachineInput): MachineResult {
  // 1. Can we still SEE? Checked before anything else, because every judgement below depends on
  //    it. A trigger key refusing while we hold a live setup is not a pause: it is a reportable
  //    state (ruled 2026-10-12), and the user would most want to know the system is impaired
  //    precisely while a setup is live.
  if (!input.triggerKeysAvailable) {
    return result('ARMED', [], { refusal: 'blind_while_armed' });
  }

  // 2. A hole in the window ends the setup, whatever else is true — including a trigger at this
  //    close. The trigger may have fired in a bar we never evaluated, so firing now would stamp
  //    it with the wrong close and the wrong price. Checked BEFORE the trigger for that reason.
  if (!input.windowContiguous) {
    return result('IDLE', ['expired_unevaluable'], { refusal: 'window_not_contiguous' });
  }

  // 3. Invalidation beats a trigger at the same close: the setup's own rules said this is no
  //    longer the setup it was, and firing it would be acting on a premise we just withdrew.
  if (input.verdict.invalidated) return result('IDLE', ['invalidated']);

  if (input.verdict.triggered) return result('TRIGGERED', ['triggered']);

  // 4. The TTL is last, so a trigger on the final bar still counts. An ARMED setup that reaches
  //    its TTL with the window intact expired honestly: the market did not oblige.
  if (input.ttlReached) return result('IDLE', ['expired']);

  return result('ARMED');
}

function stepIdle(input: MachineInput): MachineResult {
  if (!input.verdict.wantsArm) {
    // Did the playbook decline, or could it not be asked? The second is not evidence about the
    // market and must not be counted as though it were.
    return input.armKeysAvailable
      ? result('IDLE')
      : result('IDLE', [], { refusal: 'insufficient_features' });
  }

  // The playbook wants to arm. Everything from here is a reason it may not.
  if (!input.armKeysAvailable) {
    return result('IDLE', [], { refusal: 'insufficient_features' });
  }

  if (input.cooldownActive) return result('IDLE');

  if (input.gate !== null && !gateWasAnswered(input.gate)) {
    // The gate could not be answered. Not a veto and not a pass — and this close leaves the
    // comparison, because counting it as "the gated arm did not arm" would read our own outage
    // as the gate costing performance.
    return result('IDLE', [], { excludeFromComparison: true });
  }

  if (input.gate !== null && input.gate.status === 'blocked') {
    // The gate was answered and said no. This IS the gate working, it stays in the comparison,
    // and D10 tracks it — the veto's own expectancy delta is the whole point of the experiment.
    return result('IDLE');
  }

  return result('ARMED', ['armed']);
}

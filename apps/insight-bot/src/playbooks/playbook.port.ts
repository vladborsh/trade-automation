import type {
  PlaybookCondition, PlaybookKeyRequirements, Setup, SetupState, WebFeatureFrame,
  WebFrameTimeframe,
} from '@trade-automation/contracts';

/**
 * IB-017 — the `Playbook` port of §8.4.
 *
 * `evaluate` is **pure: no IO, no clock, no randomness.** That is not a style preference; it is
 * what makes the stage-3 backtest runner the same function over historical frames rather than a
 * second implementation that drifts. Anything a playbook needs must arrive in `PlaybookInput`.
 *
 * Two things the design text had that are deliberately absent:
 *
 * - **`frame.complete`.** §8.4 declared the input frame as `complete === true`. Superseded by
 *   the per-key rule: a playbook declares `keys` and `canArm` decides. Taken literally the old
 *   wording is unimplementable — no frame on this tape is complete while `atr.1d.14` refuses.
 * - **anything about regime.** §8.3: no code path may read `regime_context` inside `evaluate()`
 *   except through the declared `context_gate`, which the runner applies OUTSIDE this function.
 *   Keeping regime out of the signature is how that constraint is enforced rather than asked
 *   for.
 */

export interface PlaybookInput {
  symbol: string;
  tf: WebFrameTimeframe;
  /** The bar close this evaluation is about. Never a wall clock. */
  closeTime: number;
  frame: WebFeatureFrame;
  /** This arm's own previous state — the arms diverge, and that divergence is the experiment. */
  prev: SetupState;
  /** The setup currently held, when `prev` is ARMED or TRIGGERED. */
  setup: Setup | null;
  /** `playbook_config.params` of the version this evaluation runs under. */
  params: Record<string, unknown>;
}

export interface PlaybookOutput {
  /** The playbook wants to arm at this close. The runner decides whether it may. */
  wantsArm: boolean;
  /** The held setup's trigger condition fired at this close. */
  triggered: boolean;
  /** One of the held setup's `invalidation[]` rules matched. */
  invalidated: boolean;
  /** The setup to hold, when arming. Ignored unless `wantsArm`. */
  setup?: Setup;
  /** Every condition evaluated, passed or not — the message's table and the score's share. */
  conditions: PlaybookCondition[];
}

export interface Playbook {
  readonly id: string;
  readonly tf: WebFrameTimeframe;
  /**
   * The keys this playbook needs, split by what they are needed FOR.
   *
   * A refusal in `armKeys` means "cannot arm", which is ordinary. A refusal in `triggerKeys`
   * while a setup is ARMED means we are holding a live setup and cannot tell whether it fired,
   * which is not.
   */
  readonly keys: PlaybookKeyRequirements;
  evaluate(input: PlaybookInput): PlaybookOutput;
}

/** A playbook id to its implementation. The runner iterates this; IB-018 registers P3. */
export type PlaybookRegistry = ReadonlyMap<string, Playbook>;

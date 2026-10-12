import { randomUUID } from 'crypto';
import {
  canArm, detectionSkewSec, isLateDetection,
  type Arm, type GateVerdict, type SetupTransition, type WebFeatureFrame,
} from '@trade-automation/contracts';
import type { Db, DbHandle } from '../db/db.port';
import { activeConfig, isRunnable, statusForArm, type PlaybookConfigRow } from './config';
import { NO_REGIME_AXES, evaluateContextGate, type ReadRegimeAxis } from './gate';
import type { Playbook, PlaybookRegistry } from './playbook.port';
import * as repo from './pg/playbooks.repo';
import { step, type MachineInput } from './setup-machine';
import { TIMEFRAME_MS } from '../features/recheck-schedule';
import { expectedCloses, isWindowContiguous } from './window';

/**
 * IB-017 — the runner (§8.4): for each playbook, each symbol in the signal set, each arm, at
 * that playbook's timeframe close.
 *
 * The runner owns sequencing, the database and the clock. It owns **no rules**: what a state
 * becomes is `setup-machine.ts`, what the gate says is `gate.ts`, which version is in force is
 * `config.ts`, and whether the armed window is whole is `window.ts` — all pure, all spec'd
 * without Postgres.
 *
 * ## The three properties this file has to get right
 *
 * **1. Idempotent re-run.** "Running the runner twice over the same frames inserts nothing new"
 * is harder than it sounds, because the machine is stateful: a naive second run reads the state
 * the first left behind and advances it again. So the audit row is the idempotency ledger — a
 * close already recorded for an arm is skipped entirely, before anything is read or decided.
 *
 * **2. Both arms always run.** The twin-arm comparison is worthless if an exception in the
 * gated arm quietly drops the unconditional one for that bar, so each arm is attempted
 * independently and a failure in one is recorded against that arm alone.
 *
 * **3. One transaction per (symbol, arm, close).** The audit row, the state and any signal go
 * together. A crash between them would leave a signal with no record of the evaluation that
 * produced it, or — worse — an idempotency row claiming a close was handled when its signal was
 * never written.
 */

export type SourceMode = repo.SourceMode;

export interface RunnerDeps {
  db: Db;
  registry: PlaybookRegistry;
  /** dev-1's IB-016 read. Absent until it lands, and absent means the gate fails closed. */
  readRegimeAxis?: ReadRegimeAxis;
  /** The regime row to snapshot onto a signal, if any. */
  regimeSnapshot?: (symbol: string, closeMs: number) => unknown;
}

export interface ArmOutcome {
  playbook: string;
  symbol: string;
  arm: Arm;
  outcome: repo.EvaluationRow['outcome'];
  refusal: string | null;
  /** True when this close must be dropped from both arms before they are compared. */
  excluded: boolean;
  signalWritten: boolean;
  lateDetection: boolean;
}

export interface RunSummary {
  closeMs: number;
  tf: string;
  sourceMode: SourceMode;
  evaluated: number;
  skipped: number;
  armed: number;
  triggered: number;
  signals: number;
  excluded: number;
  lateDetections: number;
  failed: Array<{ playbook: string; symbol: string; arm: Arm; error: string }>;
}

/** Arms, in a fixed order so a run is reproducible. */
const ARMS: readonly Arm[] = ['gated', 'unconditional'];

/**
 * How stale a trigger may be and still be a signal, in seconds.
 *
 * Read from `playbook_config.params.late_detection_bound_sec` when present. The fallback is one
 * bar of the playbook's own timeframe: a trigger we noticed more than a whole bar after it
 * fired is a late detection, because by then the next bar has its own answer. A literal here
 * would be a product decision hidden in code.
 */
function lateBoundSec(config: PlaybookConfigRow, tfMs: number): number {
  const configured = config.params['late_detection_bound_sec'];
  return typeof configured === 'number' ? configured : Math.floor(tfMs / 1000);
}

export class PlaybookRunner {
  constructor(private readonly deps: RunnerDeps) {}

  /**
   * One close, every playbook on that timeframe, every symbol, both arms.
   *
   * `symbols` is passed in rather than read here: the signal set is the caller's decision
   * (§2.3 makes it a config flag), and a backtest runs a different set deliberately.
   */
  async runClose(
    tf: string,
    closeMs: number,
    nowMs: number,
    symbols: readonly string[],
    frames: ReadonlyMap<string, WebFeatureFrame>,
    sourceMode: SourceMode,
  ): Promise<RunSummary> {
    const summary: RunSummary = {
      closeMs, tf, sourceMode, evaluated: 0, skipped: 0, armed: 0, triggered: 0,
      signals: 0, excluded: 0, lateDetections: 0, failed: [],
    };

    const configs = await repo.playbookConfigs(this.deps.db);
    const cooldowns = await repo.activeCooldowns(this.deps.db, closeMs, sourceMode);

    for (const playbook of this.deps.registry.values()) {
      if (playbook.tf !== tf) continue;

      // Read per close, not cached at boot: a config version bump must be picked up without a
      // restart, which is one of this task's acceptance criteria.
      const config = activeConfig(configs.filter((c) => c.playbook === playbook.id));
      if (!isRunnable(config) || config === null) continue;

      const states = await repo.statesFor(this.deps.db, playbook.id, sourceMode);

      for (const symbol of symbols) {
        const frame = frames.get(symbol);
        if (frame === undefined) continue; // no frame for this close: nothing to evaluate against

        for (const arm of ARMS) {
          try {
            const outcome = await this.runArm({
              playbook, config, symbol, arm, frame, closeMs, nowMs, sourceMode,
              prev: states.get(`${symbol}|${arm}`) ?? null,
              cooldownActive: cooldowns.has(`${playbook.id}|${symbol}`),
            });
            if (outcome === null) { summary.skipped += 1; continue; }

            summary.evaluated += 1;
            if (outcome.outcome === 'armed') summary.armed += 1;
            if (outcome.outcome === 'triggered') summary.triggered += 1;
            if (outcome.signalWritten) summary.signals += 1;
            if (outcome.excluded) summary.excluded += 1;
            if (outcome.lateDetection) summary.lateDetections += 1;
          } catch (err) {
            // Recorded against THIS arm only. A failure in the gated arm must not take the
            // unconditional arm down with it, or the comparison loses a bar on one side.
            summary.failed.push({ playbook: playbook.id, symbol, arm, error: (err as Error).message });
          }
        }
      }
    }
    return summary;
  }

  /** One arm, one close. Returns null when the close was already evaluated. */
  private async runArm(ctx: {
    playbook: Playbook;
    config: PlaybookConfigRow;
    symbol: string;
    arm: Arm;
    frame: WebFeatureFrame;
    closeMs: number;
    nowMs: number;
    sourceMode: SourceMode;
    prev: repo.StoredState | null;
    cooldownActive: boolean;
  }): Promise<ArmOutcome | null> {
    const { playbook, config, symbol, arm, frame, closeMs, nowMs, sourceMode } = ctx;
    const key = { playbook: playbook.id, symbol, arm, sourceMode, closeTimeMs: closeMs };

    // Asked FIRST, before anything is read or decided: a re-run must be a no-op, and the
    // machine being stateful means "evaluate then notice" would already have moved the state.
    if (await repo.alreadyEvaluated(this.deps.db, key)) return null;

    const prevState = ctx.prev?.state ?? 'IDLE';
    const armKeysAvailable = canArm(frame, playbook.keys.armKeys);
    const triggerKeysAvailable = canArm(frame, playbook.keys.triggerKeys);

    // The playbook is asked only when it can be answered. Calling evaluate() on a frame whose
    // keys refuse invites it to read a refusal as a value.
    const verdict = armKeysAvailable || prevState === 'ARMED'
      ? playbook.evaluate({
        symbol, tf: playbook.tf, closeTime: closeMs, frame, prev: prevState,
        setup: (ctx.prev?.setup ?? null) as never, params: config.params,
      })
      : { wantsArm: false, triggered: false, invalidated: false, conditions: [] };

    // The gate is consulted only where the machine can use it: on an IDLE → ARMED transition of
    // the GATED arm. Arm-time only, so the gated arm stays a clean subset of the unconditional
    // one and an outcome difference is attributable to the gate filtering entries.
    const gate: GateVerdict | null = arm === 'gated' && config.contextGate !== null && prevState === 'IDLE'
      ? evaluateContextGate(config.contextGate, frame, this.deps.readRegimeAxis ?? NO_REGIME_AXES)
      : null;

    const tfMs = TIMEFRAME_MS[playbook.tf];
    const windowContiguous = await this.windowIsWhole(ctx, tfMs);

    const machine: MachineInput = {
      arm,
      prev: prevState,
      verdict: { wantsArm: verdict.wantsArm, triggered: verdict.triggered, invalidated: verdict.invalidated },
      gate,
      armKeysAvailable,
      triggerKeysAvailable,
      ttlReached: ctx.prev?.expiresAtMs != null && closeMs >= ctx.prev.expiresAtMs,
      windowContiguous,
      cooldownActive: ctx.cooldownActive,
    };
    const result = step(machine);

    const transition = result.transitions[0] ?? null;
    const outcome = outcomeFor(transition, result.refusal, result.state);

    // The timing of the trigger: the BAR it fired on, and when we noticed. Two facts.
    const skew = detectionSkewSec(Math.floor(closeMs / 1000), Math.floor(nowMs / 1000));
    const timing = {
      triggerCloseTime: Math.floor(closeMs / 1000),
      detectedAt: Math.floor(nowMs / 1000),
      detectionSkewSec: skew,
    };
    const late = transition === 'triggered' && isLateDetection(timing, lateBoundSec(config, tfMs));

    let signalWritten = false;

    // One transaction: the audit row, the state and the signal travel together, or none do.
    await this.deps.db.transaction(async (tx: DbHandle) => {
      await repo.recordEvaluation(tx, {
        playbook: playbook.id,
        version: ctx.prev?.version ?? config.version,
        symbol,
        arm,
        sourceMode,
        closeTimeMs: closeMs,
        // A late detection is recorded as the trigger it was, with the skew on the signal —
        // except that no signal is written for it. See below.
        outcome: late ? 'refused' : outcome,
        refusal: late ? 'late_detection' : result.refusal,
        gateStatus: gate?.status ?? null,
        gateRefusal: gate !== null && gate.status === 'unavailable' ? gate.refusal : null,
        excludeFromComparison: result.excludeFromComparison,
      });

      await repo.writeState(tx, {
        playbook: playbook.id,
        symbol,
        arm,
        sourceMode,
        state: late ? 'IDLE' : result.state,
        // A setup keeps the version it ARMED under until it closes; a new version applies to
        // new arms only, or thresholds move underneath a live setup and the signal's recorded
        // params are not the ones that produced it.
        version: transition === 'armed' ? config.version : (ctx.prev?.version ?? config.version),
        setup: transition === 'armed' ? (verdict.setup ?? null) : (result.state === 'IDLE' ? null : ctx.prev?.setup ?? null),
        armedAtMs: transition === 'armed' ? closeMs : (result.state === 'IDLE' ? null : ctx.prev?.armedAtMs ?? null),
        expiresAtMs: transition === 'armed'
          ? closeMs + ttlBars(config) * tfMs
          : (result.state === 'IDLE' ? null : ctx.prev?.expiresAtMs ?? null),
      });

      if (transition === 'triggered' && !late) {
        const setup = (ctx.prev?.setup ?? verdict.setup ?? null) as { direction?: 'long' | 'short' } | null;
        signalWritten = await repo.insertSignal(tx, {
          id: randomUUID(),
          playbook: playbook.id,
          version: ctx.prev?.version ?? config.version,
          arm,
          sourceMode,
          symbol,
          direction: setup?.direction ?? 'long',
          triggerCloseTimeMs: closeMs,
          detectedAtMs: nowMs,
          detectionSkewSec: skew,
          tf: playbook.tf,
          setup,
          featureSnapshot: frame,
          regime: this.deps.regimeSnapshot?.(symbol, closeMs) ?? null,
          statusAtSignal: statusForArm(config, arm),
          expiresAtMs: ctx.prev?.expiresAtMs ?? null,
        });
      }
    });

    return {
      playbook: playbook.id, symbol, arm,
      outcome: late ? 'refused' : outcome,
      refusal: late ? 'late_detection' : result.refusal,
      excluded: result.excludeFromComparison,
      signalWritten,
      lateDetection: late,
    };
  }

  /**
   * Was every close since arming evaluated by THIS arm, in THIS mode?
   *
   * Only asked of an ARMED setup — an IDLE arm has no window to be whole. Read from the
   * evaluation rows the arm actually wrote rather than re-derived from today's frames: the
   * buckets may have healed since, and a reconstruction is not a record.
   */
  private async windowIsWhole(
    ctx: { playbook: Playbook; symbol: string; arm: Arm; sourceMode: SourceMode; closeMs: number; prev: repo.StoredState | null },
    tfMs: number,
  ): Promise<boolean> {
    if (ctx.prev?.state !== 'ARMED' || ctx.prev.armedAtMs === null) return true;
    const expected = expectedCloses(ctx.prev.armedAtMs, ctx.closeMs - tfMs, tfMs);
    if (expected.length === 0) return true;
    const seen = await repo.evaluatedCloses(this.deps.db, {
      playbook: ctx.playbook.id, symbol: ctx.symbol, arm: ctx.arm, sourceMode: ctx.sourceMode,
      fromMs: ctx.prev.armedAtMs, toMs: ctx.closeMs - tfMs,
    });
    return isWindowContiguous(expected, seen);
  }
}

/** `armed_ttl_bars` from the config, defaulting to §9.1's 8 when a playbook does not say. */
function ttlBars(config: PlaybookConfigRow): number {
  const value = config.params['armed_ttl_bars'];
  return typeof value === 'number' && value > 0 ? value : 8;
}

/** The audit row's closed vocabulary, from the machine's transition and refusal. */
function outcomeFor(
  transition: SetupTransition | null,
  refusal: string | null,
  state: string,
): repo.EvaluationRow['outcome'] {
  if (transition !== null) return transition as repo.EvaluationRow['outcome'];
  if (refusal !== null) return 'refused';
  // No transition and no refusal: we evaluated and nothing moved. `held` for an arm carrying a
  // setup, `declined` for one that is not — the difference between "waiting" and "looked and
  // said no", which a single bucket would lose.
  return state === 'ARMED' || state === 'TRIGGERED' ? 'held' : 'declined';
}

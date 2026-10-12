import { type WebFeatureFrame, type WebFrameTimeframe, featureSpecFingerprint } from '@trade-automation/contracts';
import type { Db } from '../db/db.port';
import { computeAll } from './compute';
import { applyAmendment, decideAmendment } from './frame-amendment';
import { assembleFrame } from './frame-assembly';
import { gather, loadPassContext, type PassContext } from './gather';
import { lookbackMs } from './required-windows';

/** The widest window the pass's coverage question has to cover: the z-score's own lookback. */
const LIQ_LOOKBACK_MS = lookbackMs('liq');
import { assessWindows } from './input-completeness';
import * as inputs from './pg/feature-inputs.repo';
import * as frames from './pg/frames.repo';

/**
 * IB-015 — the feature pass (design §8.1): read, compute, refuse, write, and on a later look,
 * amend.
 *
 * The service owns sequencing and the database. It owns **no rules**: what a short window means
 * is `input-completeness.ts`, what the frame then says is `frame-assembly.ts`, and what a
 * re-check may change is `frame-amendment.ts` — all pure, all spec'd without a database. That
 * split is the point. The rule this task exists to enforce, that nothing arms on an unhealed
 * bucket, is not something to verify by standing up Postgres and hoping.
 */

export type PassAction = 'written' | 'amended' | 'unchanged';

/**
 * Who is writing: the pass at the close, or a run over history.
 *
 * Threaded explicitly from every entry point rather than inferred from the clock. Inferring it
 * — "closeMs is old, so this must be a backfill" — would be wrong exactly when it matters, on a
 * live pass that woke late, and would mark a genuinely live frame as better informed than it is.
 */
export type ComputedMode = 'live' | 'backfill';

export interface CloseOutcome {
  symbol: string;
  action: PassAction;
  frame: WebFeatureFrame;
  /** Recomputes that would have changed a published value. The published value stood. */
  conflicts: number;
}

export interface PassSummary {
  tf: WebFrameTimeframe;
  closeMs: number;
  written: number;
  amended: number;
  unchanged: number;
  conflicts: number;
  failed: Array<{ symbol: string; error: string }>;
  outcomes: CloseOutcome[];
}

export class FeaturePassService {
  constructor(private readonly db: Db) {}


  /**
   * One symbol, one close.
   *
   * The write and the conflict records go in **one transaction**: a conflict is the evidence
   * that a published value was left standing, and a crash between the two would leave a frame
   * amended with no record of what was discarded to get there.
   */
  async runClose(
    symbol: string,
    tf: WebFrameTimeframe,
    closeMs: number,
    nowMs: number,
    computedMode: ComputedMode,
    /** Pass-wide facts. Loaded here when a caller runs a single close on its own. */
    context?: PassContext,
  ): Promise<CloseOutcome> {
    // The coverage window must span the z-score's lookback, not just this close: the sample is
    // built from the covered hours of the last 30 days.
    const ctx = context ?? await loadPassContext(this.db, closeMs - LIQ_LOOKBACK_MS, closeMs);
    const gathered = await gather(this.db, symbol, tf, closeMs, ctx);
    const computed = computeAll(gathered);
    const { incompleteKeys, explainedKeys, reasons } =
      assessWindows(gathered.shortfalls, gathered.evidenceByGroup);

    const fresh = assembleFrame({
      symbol,
      tf,
      closeTimeSec: Math.floor(closeMs / 1000),
      computed,
      incompleteKeys,
      explainedKeys,
      reasons,
      basis: gathered.basis,
      computedMode,
      computedAtSec: Math.floor(nowMs / 1000),
    });

    const published = await frames.publishedFrame(this.db, symbol, tf, closeMs);

    if (published === null) {
      await this.db.transaction(async (tx) => {
        await frames.insertFrame(tx, fresh);
      });
      return { symbol, action: 'written', frame: fresh, conflicts: 0 };
    }

    const decision = decideAmendment(published, fresh.keys);

    // Conflicts are recorded whether or not anything else moved: a defect does not stop being a
    // defect because no key happened to heal in the same look.
    if (decision.action === 'none') {
      if (decision.conflicts.length > 0) {
        await this.db.transaction(async (tx) => {
          await frames.recordConflicts(
            tx, { symbol, tf, closeTimeMs: closeMs, revision: published.revision }, decision.conflicts,
          );
        });
      }
      return { symbol, action: 'unchanged', frame: published, conflicts: decision.conflicts.length };
    }

    // The amendment carries the mode of the pass writing IT, which need not match the published
    // revision's: a backfill amending a live frame writes a backfill revision, leaving revision 1
    // as the honest live record of what was knowable at the close.
    const amended = applyAmendment(published, decision, Math.floor(nowMs / 1000), reasons, computedMode);
    await this.db.transaction(async (tx) => {
      await frames.insertFrame(tx, amended);
      await frames.recordConflicts(
        tx, { symbol, tf, closeTimeMs: closeMs, revision: published.revision }, decision.conflicts,
      );
    });
    return { symbol, action: 'amended', frame: amended, conflicts: decision.conflicts.length };
  }

  /**
   * Every symbol in the signal set, for one close.
   *
   * **One symbol's failure does not stop the pass.** A thrown error here is a bug in a
   * calculator or a database that went away, and in either case the other twenty-nine symbols
   * still have frames worth writing — a pass that aborts on the first failure turns one broken
   * symbol into a missing frame for all of them, which is IB-BUG-010's shape exactly.
   */
  async runPass(
    tf: WebFrameTimeframe,
    closeMs: number,
    nowMs: number,
    computedMode: ComputedMode,
    /**
     * A re-check (§8.1's +30 s and +60 s) visits only the frames that refused with something
     * chaseable. The grace look visits the whole signal set, because none of them have a frame
     * yet.
     */
    only: 'all' | 'awaiting-heal' = 'all',
  ): Promise<PassSummary> {
    // The version claim is NOT here. It lives inside `insertFrame`, the write primitive, so no
    // caller can reach the table without it — IB-049. Asserting at this level is what let
    // `features.cli --symbol` bypass it entirely.

    const symbols = only === 'all'
      ? await inputs.signalSetSymbols(this.db)
      : await frames.symbolsAwaitingHeal(this.db, tf, closeMs);
    // Read once for the whole pass, not once per symbol — see `loadPassContext`.
    const context = await loadPassContext(this.db, closeMs - LIQ_LOOKBACK_MS, closeMs);
    const summary: PassSummary = {
      tf, closeMs, written: 0, amended: 0, unchanged: 0, conflicts: 0, failed: [], outcomes: [],
    };

    for (const symbol of symbols) {
      try {
        const outcome = await this.runClose(symbol, tf, closeMs, nowMs, computedMode, context);
        summary.outcomes.push(outcome);
        summary.conflicts += outcome.conflicts;
        if (outcome.action === 'written') summary.written += 1;
        else if (outcome.action === 'amended') summary.amended += 1;
        else summary.unchanged += 1;
      } catch (err) {
        summary.failed.push({ symbol, error: (err as Error).message });
      }
    }
    return summary;
  }

  /** The fingerprint this build computes — for a CLI to print alongside what it wrote. */
  static fingerprint(): string {
    return featureSpecFingerprint();
  }
}

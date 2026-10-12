/**
 * IB-016 — the shape of a feature value, **until IB-015's contract is on master**.
 *
 * `WebFeatureValue` and `WebFeatureUnavailable` live in `libs/contracts/src/insight/feature-frame.ts`
 * on dev-2's `ib-feature-frame`, which is committed but not merged. This file exists only so the
 * regime calculators can be written and spec'd against that shape today without importing from a
 * branch, and it is written to be **deleted**:
 *
 * - the reason list below is a copy of `WEB_FEATURE_UNAVAILABLE`, in its order, and is the only
 *   duplicated thing here;
 * - `assertMatchesContract` is the one-line spec that proves the copy still matches, and it is
 *   wired up the moment IB-015 lands — at which point this module's types become re-exports of
 *   the contract's, and then go entirely.
 *
 * It is a copy with a stated end, rather than a second definition: the alternative was either
 * importing across an unmerged branch or inventing a regime-specific vocabulary for the same six
 * facts, and a reader who has learned `insufficient_history` on a key should not meet a different
 * word for it on an axis.
 */

/** Mirrors `WEB_FEATURE_UNAVAILABLE` (IB-015). Order matters only for the equality spec. */
export const FRAME_REFUSAL_REASONS = [
  'no_data',
  'insufficient_history',
  'incomplete_input',
  'not_applicable',
  'convention_changed',
  'explained_absence',
] as const;

export type FrameRefusalReason = (typeof FRAME_REFUSAL_REASONS)[number];

/** A count that carries its own denominator, as IB-015 defines it. */
export interface FrameCount {
  count: number;
  of: number;
}

/** One feature value: a measurement, or a stated refusal. Never a nullable number. */
export type FrameFeatureValue =
  | { ok: true; value: number | boolean | string | FrameCount }
  | { ok: false; why: FrameRefusalReason };

/**
 * Called by the spec once IB-015 is on master: `assertMatchesContract(WEB_FEATURE_UNAVAILABLE)`.
 * Exported now so the wiring is obvious to whoever merges them, rather than left as a comment.
 */
export function assertMatchesContract(contractReasons: readonly string[]): void {
  const mine = [...FRAME_REFUSAL_REASONS].sort().join(',');
  const theirs = [...contractReasons].sort().join(',');
  if (mine !== theirs) {
    throw new Error(
      `regime's copy of the refusal vocabulary has drifted from the contract: [${mine}] vs [${theirs}]. ` +
        'Delete apps/insight-bot/src/regime/feature-value.ts and import from @trade-automation/contracts.',
    );
  }
}

import { featureParamNumber, type WebFeatureKey, type WebFeatureValue } from '@trade-automation/contracts';
import { log1pZScore } from '../math/rolling';

/**
 * IB-015 — the liquidation group of §8.2, pure. Four window sums and two z-scores.
 *
 * The sums and the z-scores refuse for DIFFERENT reasons and that distinction is the point: a
 * quiet 15 minutes is a real zero and is reported as one, while a z-score over too little
 * history is not computable at all. §8.2 is explicit — `null` until 14 days of liquidation
 * history exist — and on the current tape most of these will refuse for weeks. That is expected
 * and is the product-readiness number, not a defect.
 *
 * Venue canonicalisation happens in the read (IB-BUG-011): a sum over one venue's rows labelled
 * as the market is the bug that showed 10 % of the money under «все биржи».
 */

const ok = (value: number): WebFeatureValue => ({ ok: true, value });
const no = (why: 'no_data' | 'insufficient_history' | 'explained_absence'): WebFeatureValue =>
  ({ ok: false, why });

/**
 * IB-038's three states, applied to the liquidation tape (the Tech Lead's ruling of 2026-10-12).
 *
 * Which state we are in decides WHICH refusal, and the three are deliberately different reasons
 * rather than one shrug:
 *
 * - `covered` — every liquidation stream was live for the whole window. A zero here is a real
 *   measurement: we were listening and nothing was liquidated.
 * - `uncovered` — coverage is recorded and says we were NOT listening. The data never existed
 *   and no heal will produce it, so the refusal is `explained_absence`: permanent, evidenced by
 *   a `collector_gaps` row, and explicitly not counted as an unhealed gap. Counting it would
 *   light an alarm nobody can ever clear.
 * - `not_recorded` — no liquidation stream has ever reported liveness, so we do not know either
 *   way. `no_data`, because the honest answer is that we cannot say — not `explained_absence`,
 *   which would claim evidence we do not have, and not `incomplete_input`, which would promise
 *   somebody can fix it.
 */
export type LiqCoverageState = 'covered' | 'uncovered' | 'not_recorded';

const refusalFor = (state: Exclude<LiqCoverageState, 'covered'>): WebFeatureValue =>
  no(state === 'uncovered' ? 'explained_absence' : 'no_data');

export type LiqSide = 'long' | 'short';
export const LIQ_SIDES: readonly LiqSide[] = ['long', 'short'];

export interface LiqInput {
  /** Σ USD per side over the trailing 15 and 60 minutes. A quiet window is 0, not absent. */
  sums: Record<LiqSide, { m15: number; m60: number }>;
  /**
   * The symbol's own trailing 60-minute sums per side, **one per COVERED hour of the lookback**.
   *
   * Uncovered hours are absent from this list rather than present as zero. An hour nobody was
   * listening to is not a quiet hour, and padding it in gave the first live frame a sample with
   * a fat false-calm tail against which every real hour scored several sigma.
   *
   * Short of `minHistoryDays` worth of COVERED hours, the z-score refuses.
   */
  history: Record<LiqSide, readonly number[]>;
  /**
   * Whether we were listening across the window being scored — see `LiqCoverageState`.
   *
   * Replaces a `hasAnyHistory` boolean that asked a different and weaker question ("has this
   * symbol ever liquidated"), which could not distinguish a quiet coin from a dark collector.
   */
  coverage: LiqCoverageState;
}

export function liquidationFeatures(input: LiqInput): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const out: Partial<Record<WebFeatureKey, WebFeatureValue>> = {};
  const lookbackDays = featureParamNumber('liq.long.z60m', 'lookbackDays');
  const minHistoryDays = featureParamNumber('liq.long.z60m', 'minHistoryDays');
  const windowMinutes = featureParamNumber('liq.long.z60m', 'windowMinutes');
  // one sample per complete window of the lookback: 14 days of 60-minute windows is 336
  const minSamples = Math.ceil((minHistoryDays * 24 * 60) / windowMinutes);
  void lookbackDays;

  for (const side of LIQ_SIDES) {
    const sums = input.sums[side];
    // A calm window we were listening to is 0 — a real measurement. A window we were not
    // listening to is not a small number, it is no number: a cross-venue sum with one venue
    // dark is understated, which is the «все биржи» error inside a single figure rather than
    // in a label, and understated is worse than missing because it still looks like data.
    const covered = input.coverage === 'covered';
    out[`liq.${side}.15m` as WebFeatureKey] = covered ? ok(sums.m15) : refusalFor(input.coverage as Exclude<LiqCoverageState, 'covered'>);
    out[`liq.${side}.60m` as WebFeatureKey] = covered ? ok(sums.m60) : refusalFor(input.coverage as Exclude<LiqCoverageState, 'covered'>);

    // The z-score is gated on `hasAnyHistory` as well as on the sample size, and the two are
    // not the same check.
    //
    // Without this a frame could say `liq.long.60m: no_data` and `liq.long.z60m: 3.9` in the
    // same breath — a standard-deviation score of a quantity the frame has just said it does
    // not have. Observed on the first real run. A consumer reading per key, as it is supposed
    // to, would take the z-score at face value and arm on it.
    //
    // Whatever makes the sum unmeasurable makes a statistic ABOUT that sum unmeasurable too.
    const z = covered
      ? log1pZScore(
        input.history[side], sums.m60, minSamples,
        featureParamNumber(`liq.${side}.z60m` as 'liq.long.z60m', 'spreadEpsilonRelative'),
      )
      : null;
    // Outside `covered` the z-score carries the SAME reason as its sum, so a frame can never
    // again say `no_data` for a quantity and publish a statistic about it in the next line.
    out[`liq.${side}.z60m` as WebFeatureKey] = !covered
      ? refusalFor(input.coverage as Exclude<LiqCoverageState, 'covered'>)
      : z === null ? no('insufficient_history') : ok(z);
  }
  return out;
}

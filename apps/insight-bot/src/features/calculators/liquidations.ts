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
const no = (why: 'no_data' | 'insufficient_history'): WebFeatureValue => ({ ok: false, why });

export type LiqSide = 'long' | 'short';
export const LIQ_SIDES: readonly LiqSide[] = ['long', 'short'];

export interface LiqInput {
  /** Σ USD per side over the trailing 15 and 60 minutes. A quiet window is 0, not absent. */
  sums: Record<LiqSide, { m15: number; m60: number }>;
  /**
   * The symbol's own trailing 60-minute sums per side over the lookback, one per complete hour.
   * Short of `minHistoryDays` worth, the z-score refuses.
   */
  history: Record<LiqSide, readonly number[]>;
  /** Whether any liquidation has ever been stored for this symbol — distinguishes 0 from absent. */
  hasAnyHistory: boolean;
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
    // A venue that reported nothing at all is absent; a venue that reported a calm window is 0.
    out[`liq.${side}.15m` as WebFeatureKey] = input.hasAnyHistory ? ok(sums.m15) : no('no_data');
    out[`liq.${side}.60m` as WebFeatureKey] = input.hasAnyHistory ? ok(sums.m60) : no('no_data');

    // The z-score is gated on `hasAnyHistory` as well as on the sample size, and the two are
    // not the same check.
    //
    // Without this a frame could say `liq.long.60m: no_data` and `liq.long.z60m: 3.9` in the
    // same breath — a standard-deviation score of a quantity the frame has just said it does
    // not have. Observed on the first real run. A consumer reading per key, as it is supposed
    // to, would take the z-score at face value and arm on it.
    //
    // Whatever makes the sum unmeasurable makes a statistic ABOUT that sum unmeasurable too.
    const z = input.hasAnyHistory
      ? log1pZScore(
        input.history[side], sums.m60, minSamples,
        featureParamNumber(`liq.${side}.z60m` as 'liq.long.z60m', 'spreadEpsilonRelative'),
      )
      : null;
    out[`liq.${side}.z60m` as WebFeatureKey] = z === null ? no('insufficient_history') : ok(z);
  }
  return out;
}

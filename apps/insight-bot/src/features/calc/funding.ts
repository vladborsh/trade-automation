import { WINDOWS, type FeatureFrameValues } from '../feature-keys';
import { percentileRank } from './percentile';

/**
 * IB-015 — the funding group (§8.2).
 *
 * The venue count is the interesting part. `funding.extreme_hi_venues` is "how many venues are
 * simultaneously at an extreme", which is the observable the squeeze family was built on — and
 * the one the Researcher found never co-occurred across two venues in a holdout year (§16.5).
 * It is still computed and stored: the frame is a record, and a count of zero is evidence.
 *
 * **A venue with too little history contributes nothing rather than a zero.** `pct30d` is null
 * below `minPeriods`, and a null cannot be "not extreme" — it is unknown, and counting it as
 * not-extreme would understate the count exactly when a venue is newly listed.
 */

export interface VenueFunding {
  venue: 'binance' | 'bybit' | 'okx';
  /** The last settled rate at the frame's close, or null when the venue has none. */
  rate: number | null;
  /** That venue's settlement history, oldest first, for the percentile. */
  history: readonly number[];
}

export interface FundingInput {
  venues: readonly VenueFunding[];
  /** Binance's last `predicted_funding_rate` (§8.2), or null. */
  predictedBinance: number | null;
}

/** A venue is at an extreme when BOTH its percentile and its absolute rate say so (§8.2). */
export function isExtremeHigh(pct: number | null, rate: number | null): boolean {
  if (pct === null || rate === null) return false;
  return pct >= WINDOWS.extremeHiPct && rate >= WINDOWS.extremeHiRate;
}

export function isExtremeLow(pct: number | null, rate: number | null): boolean {
  if (pct === null || rate === null) return false;
  return pct <= WINDOWS.extremeLoPct && rate <= WINDOWS.extremeLoRate;
}

export function computeFunding(input: FundingInput): FeatureFrameValues {
  const out: FeatureFrameValues = {
    'funding.predicted.binance': input.predictedBinance,
  };

  let hi = 0;
  let lo = 0;
  for (const venue of input.venues) {
    const pct = percentileRank(venue.rate, venue.history, {
      minPeriods: WINDOWS.fundingPercentileMinPeriods,
      window: WINDOWS.fundingPercentileSamples,
    });
    out[`funding.${venue.venue}.rate`] = venue.rate;
    out[`funding.${venue.venue}.pct30d`] = pct;
    if (isExtremeHigh(pct, venue.rate)) hi++;
    if (isExtremeLow(pct, venue.rate)) lo++;
  }

  out['funding.extreme_hi_venues'] = hi;
  out['funding.extreme_lo_venues'] = lo;
  return out;
}

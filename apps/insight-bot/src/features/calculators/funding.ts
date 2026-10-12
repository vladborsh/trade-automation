import type { WebFeatureKey, WebFeatureValue } from '@trade-automation/contracts';
import { percentileOf } from '../math/rolling';

/**
 * IB-015 — the funding group of §8.2, pure.
 *
 * Nine keys: the last settled rate per venue, its percentile among that venue's last 90
 * settlements (`min_periods` 45), the two extreme-venue counts, and Binance's predicted rate.
 *
 * **The venue set is an input, not an assumption.** The caller resolves each venue's own symbol
 * spelling (IB-BUG-011 — `BTCUSDT` on Bybit is `BTC-USDT-SWAP` on OKX) and hands over what it
 * actually found. A venue that reported nothing arrives as an absent entry and becomes
 * `no_data`, never a rate of zero.
 */

/** §8.2's funding-family thresholds. Fixed here with the key set; a change is a new version. */
export const FUNDING_EXTREME = {
  hiPercentile: 0.9,
  hiRate: 0.0003,
  loPercentile: 0.1,
  loRate: -0.0003,
  /** §8.2: the venue's last 90 settlements, `min_periods` 45. */
  window: 90,
  minPeriods: 45,
} as const;

export const FUNDING_VENUES = ['binance', 'bybit', 'okx'] as const;
export type FundingVenue = (typeof FUNDING_VENUES)[number];

export interface FundingInput {
  /**
   * Settled rates per venue, **ascending by settlement time**. The caller owns the ordering and
   * the window; at most the last `FUNDING_EXTREME.window` are used.
   */
  settled: Partial<Record<FundingVenue, readonly number[]>>;
  /** Binance's last `predicted_funding_rate`, or null when none is stored. */
  predictedBinance: number | null;
}

const ok = (value: number | boolean | { count: number; of: number }): WebFeatureValue =>
  ({ ok: true, value });
const no = (why: 'no_data' | 'insufficient_history'): WebFeatureValue => ({ ok: false, why });

/**
 * One venue's rate and percentile.
 *
 * Note the two refusals are **different**: a venue with no settlements has no rate at all
 * (`no_data`), while a venue with twelve settlements has a perfectly good rate and no
 * percentile (`insufficient_history`). Collapsing them would lose the only information that
 * tells an operator whether to wait or to go looking for a collector.
 */
function venueKeys(rates: readonly number[] | undefined): { rate: WebFeatureValue; pct: WebFeatureValue } {
  if (!rates || rates.length === 0) return { rate: no('no_data'), pct: no('no_data') };
  const last = rates[rates.length - 1] as number;
  const window = rates.slice(-FUNDING_EXTREME.window);
  const pct = percentileOf(window, last, FUNDING_EXTREME.minPeriods);
  return { rate: ok(last), pct: pct === null ? no('insufficient_history') : ok(pct) };
}

export function fundingFeatures(input: FundingInput): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const out: Partial<Record<WebFeatureKey, WebFeatureValue>> = {};

  /** Venues we could actually assess: both a rate AND a percentile. This is the denominator. */
  const assessable: Array<{ rate: number; pct: number }> = [];

  for (const venue of FUNDING_VENUES) {
    const { rate, pct } = venueKeys(input.settled[venue]);
    out[`funding.${venue}.rate` as WebFeatureKey] = rate;
    out[`funding.${venue}.pct30d` as WebFeatureKey] = pct;
    if (rate.ok && pct.ok) {
      assessable.push({ rate: rate.value as number, pct: pct.value as number });
    }
  }

  // `of` is the venues that could be assessed, not the venues we hope to collect — the same
  // rule as `venuesPresent`. A venue with a rate but no percentile cannot be tested against
  // §8.2's two-part condition, so it is in neither the numerator nor the denominator.
  //
  // With nothing assessable the answer is a REFUSAL, not `0 of 0`. "0 of 0 extreme" is the
  // 0-of-0 basis line that was flagged as a defect on the coverage page: a ratio with an empty
  // denominator reads as calm and measures nothing.
  if (assessable.length === 0) {
    out['funding.extreme_hi_venues'] = no('insufficient_history');
    out['funding.extreme_lo_venues'] = no('insufficient_history');
  } else {
    const of = assessable.length;
    const hi = assessable.filter(
      (v) => v.pct >= FUNDING_EXTREME.hiPercentile && v.rate >= FUNDING_EXTREME.hiRate,
    ).length;
    const lo = assessable.filter(
      (v) => v.pct <= FUNDING_EXTREME.loPercentile && v.rate <= FUNDING_EXTREME.loRate,
    ).length;
    out['funding.extreme_hi_venues'] = ok({ count: hi, of });
    out['funding.extreme_lo_venues'] = ok({ count: lo, of });
  }

  out['funding.predicted.binance'] =
    input.predictedBinance === null ? no('no_data') : ok(input.predictedBinance);

  return out;
}

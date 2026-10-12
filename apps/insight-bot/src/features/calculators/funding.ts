import { featureParamNumber, type WebFeatureKey, type WebFeatureValue } from '@trade-automation/contracts';
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

/**
 * §8.2's funding-family constants, **read from the contract registry rather than restated here**.
 *
 * They used to be literals in this file while the registry carried the same numbers as prose.
 * That is two declarations of one fact, and the fingerprint watched neither: changing the window
 * from 90 settlements to 60 would have moved the number a reader acts on while the registry,
 * `featureSpecFingerprint()` and every spec stayed green (Tech Lead, 2026-10-12). Now the
 * registry is the only copy, it is inside the fingerprint, and this module cannot disagree with
 * the contract because it has nothing of its own to disagree with.
 */
export const FUNDING_EXTREME = {
  hiPercentile: featureParamNumber('funding.extreme_hi_venues', 'percentile'),
  hiRate: featureParamNumber('funding.extreme_hi_venues', 'rate'),
  loPercentile: featureParamNumber('funding.extreme_lo_venues', 'percentile'),
  loRate: featureParamNumber('funding.extreme_lo_venues', 'rate'),
  window: featureParamNumber('funding.binance.pct30d', 'settlements'),
  minPeriods: featureParamNumber('funding.binance.pct30d', 'minPeriods'),
  /** The convention the key's NAME depends on, asserted below rather than assumed. */
  settlementHours: featureParamNumber('funding.binance.pct30d', 'settlementHours'),
  intervalTolerance: featureParamNumber('funding.binance.pct30d', 'intervalTolerance'),
} as const;

export const FUNDING_VENUES = ['binance', 'bybit', 'okx'] as const;
export type FundingVenue = (typeof FUNDING_VENUES)[number];

/** One settlement: the instant matters as much as the rate — see `settlementIntervalHours`. */
export interface Settlement {
  /** Epoch seconds, UTC. */
  timeSec: number;
  rate: number;
}

export interface FundingInput {
  /**
   * Settlements per venue, **ascending by settlement time**. The caller owns the ordering and
   * the window; at most the last `FUNDING_EXTREME.window` are used.
   *
   * Times are carried, not just rates, because `pct30d`'s name is only true at an 8-hourly
   * settlement interval and the interval has to be measured to know.
   */
  settled: Partial<Record<FundingVenue, readonly Settlement[]>>;
  /** Binance's last `predicted_funding_rate`, or null when none is stored. */
  predictedBinance: number | null;
}

/**
 * The venue's typical settlement interval in hours, from the MEDIAN gap in the window.
 *
 * Median rather than mean: a single missed settlement doubles one gap, and a mean would call an
 * 8-hourly venue 9-hourly on one outage. `null` when there are not two settlements to measure.
 */
export function settlementIntervalHours(settlements: readonly Settlement[]): number | null {
  if (settlements.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < settlements.length; i += 1) {
    gaps.push((settlements[i] as Settlement).timeSec - (settlements[i - 1] as Settlement).timeSec);
  }
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const medianSec = gaps.length % 2 === 1
    ? (gaps[mid] as number)
    : ((gaps[mid - 1] as number) + (gaps[mid] as number)) / 2;
  return medianSec / 3600;
}

/** Does the window still settle at the interval the key's name assumes? */
export function matchesSettlementConvention(settlements: readonly Settlement[]): boolean {
  const hours = settlementIntervalHours(settlements);
  if (hours === null) return true; // nothing measurable: the sample refusal already covers it
  const expected = FUNDING_EXTREME.settlementHours;
  return Math.abs(hours - expected) / expected <= FUNDING_EXTREME.intervalTolerance;
}

const ok = (value: number | boolean | { count: number; of: number }): WebFeatureValue =>
  ({ ok: true, value });
const no = (why: 'no_data' | 'insufficient_history' | 'convention_changed'): WebFeatureValue =>
  ({ ok: false, why });

/**
 * One venue's rate and percentile.
 *
 * Note the two refusals are **different**: a venue with no settlements has no rate at all
 * (`no_data`), while a venue with twelve settlements has a perfectly good rate and no
 * percentile (`insufficient_history`). Collapsing them would lose the only information that
 * tells an operator whether to wait or to go looking for a collector.
 */
function venueKeys(settlements: readonly Settlement[] | undefined): { rate: WebFeatureValue; pct: WebFeatureValue } {
  if (!settlements || settlements.length === 0) return { rate: no('no_data'), pct: no('no_data') };
  const window = settlements.slice(-FUNDING_EXTREME.window);
  const last = window[window.length - 1] as Settlement;

  // The rate is always reportable: it is the last settled rate and nothing about the interval
  // changes what it is.
  if (!matchesSettlementConvention(window)) {
    // The percentile is not. At 4-hourly, 90 settlements is 15 days and `pct30d` would be
    // measuring half the window its name claims — and `extreme_*_venues` would then compare a
    // 15-day percentile against its neighbours' 30-day ones. Refusing drops the venue from the
    // `of` denominator too, which keeps the cross-venue count honest rather than mixed.
    return { rate: ok(last.rate), pct: no('convention_changed') };
  }

  const pct = percentileOf(window.map((s) => s.rate), last.rate, FUNDING_EXTREME.minPeriods);
  return { rate: ok(last.rate), pct: pct === null ? no('insufficient_history') : ok(pct) };
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

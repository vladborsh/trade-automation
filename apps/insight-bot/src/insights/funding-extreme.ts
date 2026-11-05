import { FUNDING_FLOOR_PER_8H, RARITY_SHOW } from './thresholds';

/**
 * IB-135 (market round 3 §1, alerts design F2/F3) — is a coin's funding worth a word? Pure.
 *
 * `high` when the rate is rare for the coin (two-sided rarity ≥ `RARITY_SHOW`) AND, normalised to
 * 8 h, at or above `+FUNDING_FLOOR_PER_8H`; `low` mirrors it at or below `−FLOOR`; otherwise null.
 * The rarity alone is not enough: a month at the 0.01 % base rate makes 0.0206 % rare (BNB).
 *
 * **Normalised to 8 h:** `rate × 8 / intervalH`. A 4 h coin at 0.016 % pays what an 8 h coin pays
 * at 0.032 %. **An unknown interval counts as 8 h.** No Binance perp settles less often than every
 * 8 h, so the assumption can only make a shorter-interval coin look SMALLER than it is. When the
 * interval is unknown, the error is silence, never a false statement.
 *
 * Users: R5 (its filter and its count), `signalOf`'s `crowded_long` / `crowded_short`, and IB-124's
 * funding alerts. They share it so that the card, the table and the alert cannot disagree.
 */
export type FundingExtreme = 'high' | 'low';

/** The rate as if it settled every 8 h. An unknown interval counts as 8 h (see above). */
export function fundingPer8h(rate: number, intervalH: number | null): number {
  return rate * (8 / (intervalH ?? 8));
}

export function fundingExtreme(rate: number | null, rarity: number | null, intervalH: number | null): FundingExtreme | null {
  if (rate === null || rarity === null || rarity < RARITY_SHOW) return null;
  const per8h = fundingPer8h(rate, intervalH);
  if (per8h >= FUNDING_FLOOR_PER_8H) return 'high';
  if (per8h <= -FUNDING_FLOOR_PER_8H) return 'low';
  return null;
}

/** How many of the latest settlement spacings the interval is the median of. */
export const FUNDING_INTERVAL_SPACINGS = 3;

/**
 * The coin's settlement interval in whole hours: the median of its last 3 spacings (4 settlements),
 * from the settled times (s, oldest first) the baseline already holds (`fundingTimes`, IB-118). No
 * venue call. With an odd count, one irregular gap cannot move the median: a missed record, or the
 * one gap that spans an interval switch. Null under 4 settlements, or for a spacing under an hour.
 */
export function fundingIntervalH(timesSec: readonly number[]): number | null {
  const n = FUNDING_INTERVAL_SPACINGS;
  if (timesSec.length < n + 1) return null;
  const last = timesSec.slice(-(n + 1));
  const gaps = last.slice(1).map((t, i) => t - (last[i] as number)).sort((a, b) => a - b);
  const hours = Math.round((gaps[n >> 1] as number) / 3_600);
  return hours >= 1 ? hours : null;
}

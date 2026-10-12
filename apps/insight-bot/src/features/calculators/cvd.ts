import type { WebFeatureKey, WebFeatureValue } from '@trade-automation/contracts';

/**
 * IB-015 — the CVD group of §8.2, pure. Σ (2·takerBuyVolume − volume) over the window, in base
 * units, from `candles_1m`.
 *
 * Two refusals that are easy to get wrong and invisible once wrong:
 *
 * - **A symbol with no spot market gets `not_applicable`, never zero.** §8.2 says so explicitly.
 *   A zero spot CVD on a perp-only listing reads as perfectly balanced spot flow, which is a
 *   claim about a market that does not exist.
 * - **A bar whose `takerBuyVolume` is null breaks the sum.** The field is nullable and a missing
 *   taker split is not a balanced bar: treating null as zero would turn it into
 *   `0 − volume`, i.e. maximum selling, out of thin air. One null and the window refuses.
 */

const ok = (value: number): WebFeatureValue => ({ ok: true, value });
const no = (why: 'no_data' | 'not_applicable' | 'insufficient_history'): WebFeatureValue =>
  ({ ok: false, why });

export interface CvdBar {
  volume: number;
  /** Nullable in `candles_1m`; a null is a hole in the series, never a balanced bar. */
  takerBuyVolume: number | null;
}

export interface CvdWindows {
  /** Bars of the trailing 4 h / 24 h, and the 4 h before the last one for the slope. */
  last4h: readonly CvdBar[];
  last24h: readonly CvdBar[];
  previous4h: readonly CvdBar[];
}

export interface CvdInput {
  perp: CvdWindows;
  /** Null when the symbol has no spot market at all — not an empty window. */
  spot: CvdWindows | null;
}

/** Σ (2·taker − volume), or null when any bar is missing its taker split. */
export function cvdOf(bars: readonly CvdBar[]): number | null {
  if (bars.length === 0) return null;
  let total = 0;
  for (const bar of bars) {
    if (bar.takerBuyVolume === null) return null;
    total += 2 * bar.takerBuyVolume - bar.volume;
  }
  return total;
}

/** §8.2: the SIGN of the change against the previous window — −1, 0 or +1, never the delta. */
export function slopeSign(current: number, previous: number): number {
  return Math.sign(current - previous);
}

function windowKeys(
  market: 'perp' | 'spot',
  windows: CvdWindows | null,
  out: Partial<Record<WebFeatureKey, WebFeatureValue>>,
): void {
  if (windows === null) {
    // the whole market is absent for this symbol — a different fact from an empty window
    out[`cvd.${market}.4h` as WebFeatureKey] = no('not_applicable');
    out[`cvd.${market}.24h` as WebFeatureKey] = no('not_applicable');
    out[`cvd.${market}.slope_4h` as WebFeatureKey] = no('not_applicable');
    return;
  }

  const four = cvdOf(windows.last4h);
  const day = cvdOf(windows.last24h);
  const previous = cvdOf(windows.previous4h);

  out[`cvd.${market}.4h` as WebFeatureKey] = four === null ? no('no_data') : ok(four);
  out[`cvd.${market}.24h` as WebFeatureKey] = day === null ? no('no_data') : ok(day);
  out[`cvd.${market}.slope_4h` as WebFeatureKey] =
    four === null || previous === null ? no('no_data') : ok(slopeSign(four, previous));
}

export function cvdFeatures(input: CvdInput): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const out: Partial<Record<WebFeatureKey, WebFeatureValue>> = {};
  windowKeys('perp', input.perp, out);
  windowKeys('spot', input.spot, out);
  return out;
}

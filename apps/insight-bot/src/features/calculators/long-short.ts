import { featureParamNumber, type WebFeatureKey, type WebFeatureValue } from '@trade-automation/contracts';
import { percentileOf } from '../math/rolling';

/**
 * IB-015 — the long/short group of §8.2, pure.
 *
 * Six keys: the latest 5m ratio for each of the three kinds, and each one's 30-day percentile.
 *
 * The three kinds are different measurements of different populations — top accounts by
 * position, all accounts, and taker flow — so they are never averaged or substituted for one
 * another. A kind the venue did not report is `no_data`, not the value of its neighbour.
 */

const ok = (value: number): WebFeatureValue => ({ ok: true, value });
const no = (why: 'no_data' | 'insufficient_history'): WebFeatureValue => ({ ok: false, why });

export const LS_KINDS = ['top_position', 'global_account', 'taker'] as const;
export type LsKind = (typeof LS_KINDS)[number];

export interface LsInput {
  /** Ratios per kind, ascending by time, already restricted to the 30-day window. */
  series: Partial<Record<LsKind, readonly number[]>>;
}

export function longShortFeatures(input: LsInput): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const out: Partial<Record<WebFeatureKey, WebFeatureValue>> = {};
  const minPeriods = featureParamNumber('ls.top_position.pct30d', 'minPeriods');

  for (const kind of LS_KINDS) {
    const series = input.series[kind];
    if (!series || series.length === 0) {
      out[`ls.${kind}` as WebFeatureKey] = no('no_data');
      out[`ls.${kind}.pct30d` as WebFeatureKey] = no('no_data');
      continue;
    }
    const latest = series[series.length - 1] as number;
    out[`ls.${kind}` as WebFeatureKey] = ok(latest);
    const pct = percentileOf(series, latest, minPeriods);
    out[`ls.${kind}.pct30d` as WebFeatureKey] = pct === null ? no('insufficient_history') : ok(pct);
  }
  return out;
}

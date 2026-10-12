import { featureParamNumber, type WebFeatureKey, type WebFeatureValue } from '@trade-automation/contracts';
import { wilderAtr, type AtrBar } from '../math/wilder-atr';

/**
 * IB-015 — the ATR group of §8.2, pure. Three keys: Wilder ATR(14) on 1h, 4h and 1d bars.
 *
 * **Wilder, not the arithmetic mean of true range** — `libs/indicators/computeAtr` is the latter
 * and reusing it would have moved all three keys and the `vol` regime band while passing review.
 * The period and the smoothing are registry params, so switching either moves the fingerprint.
 */

const ok = (value: number): WebFeatureValue => ({ ok: true, value });
const no = (why: 'no_data' | 'insufficient_history'): WebFeatureValue => ({ ok: false, why });

export type AtrTf = '1h' | '4h' | '1d';
export const ATR_TFS: readonly AtrTf[] = ['1h', '4h', '1d'];

export interface AtrInput {
  /** Bars per timeframe, ascending, already restricted to complete buckets. */
  bars: Partial<Record<AtrTf, readonly AtrBar[]>>;
}

export function volatilityFeatures(input: AtrInput): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const out: Partial<Record<WebFeatureKey, WebFeatureValue>> = {};
  for (const tf of ATR_TFS) {
    const key = `atr.${tf}.14` as WebFeatureKey;
    const period = featureParamNumber(key, 'period');
    const bars = input.bars[tf];
    if (!bars || bars.length === 0) {
      out[key] = no('no_data');
      continue;
    }
    const atr = wilderAtr(bars, period);
    // null means fewer than period + 1 bars: a real shortage of history, not absent data
    out[key] = atr === null ? no('insufficient_history') : ok(atr);
  }
  return out;
}

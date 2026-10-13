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
    const warmup = featureParamNumber(key, 'warmupBars');
    const available = input.bars[tf];
    if (!available || available.length === 0) {
      out[key] = no('no_data');
      continue;
    }

    // IB-052: slice to the DECLARED window before computing, and do it here rather than in the
    // caller so the invariant is a property of this pure function: feed it more history and the
    // answer does not move.
    //
    // Wilder smoothing is recursive, so handing it "whatever was complete" made the value a
    // function of our coverage — it moved when a derive run healed buckets, and two slots with
    // different coverage disagreed about the same close. `period + 1 + warmupBars` is the only
    // thing this key is ever computed over.
    const window = period + 1 + warmup;
    if (available.length < window) {
      // Not enough history for the DECLARED window. A shortage, not absent data — and
      // deliberately not "compute it from what we have", which is the defect itself.
      out[key] = no('insufficient_history');
      continue;
    }
    const atr = wilderAtr(available.slice(available.length - window), period);
    out[key] = atr === null ? no('insufficient_history') : ok(atr);
  }
  return out;
}

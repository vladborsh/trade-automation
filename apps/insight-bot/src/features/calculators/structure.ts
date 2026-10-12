import { featureParamNumber, type WebFeatureKey, type WebFeatureValue } from '@trade-automation/contracts';
import { highestPivotHigh, impulseLow, lowestPivotLow, pivotHighs, type PivotBar } from '../math/pivots';

/**
 * IB-015 — the structure group of §8.2, pure. Pivot-based swing extremes over 12 h of 15m bars,
 * failed highs over 24 h, and the last impulse leg's low.
 *
 * A monotonic window has NO swing high, and these keys say so rather than naming the window's
 * last bar. Claiming a structure that is not there is the failure mode here: a playbook reading
 * «swing high» expects a level the market turned at, not whatever happened to be highest.
 */

const ok = (value: number): WebFeatureValue => ({ ok: true, value });
const no = (why: 'no_data' | 'insufficient_history'): WebFeatureValue => ({ ok: false, why });

export interface StructureInput {
  /** 15m bars of the trailing 12 h, ascending. */
  bars12h: readonly PivotBar[];
  /** 15m bars of the trailing 24 h, ascending, for the failed highs. */
  bars24h: readonly PivotBar[];
  /** Closes of `bars24h`, aligned by index — a failed high is one that did not CLOSE above. */
  closes24h: readonly number[];
  /** Wilder ATR(1h), or null when it could not be computed; the distance is a multiple of it. */
  atr1h: number | null;
}

export function structureFeatures(input: StructureInput): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const out: Partial<Record<WebFeatureKey, WebFeatureValue>> = {};
  const atrMultiple = featureParamNumber('structure.failed_highs_24h', 'atrMultiple');

  if (input.bars12h.length === 0) {
    out['structure.swing_high_12h'] = no('no_data');
    out['structure.swing_low_12h'] = no('no_data');
    out['structure.impulse_low_15m'] = no('no_data');
  } else {
    const high = highestPivotHigh(input.bars12h);
    const low = lowestPivotLow(input.bars12h);
    const impulse = impulseLow(input.bars12h);
    // insufficient_history, not no_data: bars exist, they simply never turned
    out['structure.swing_high_12h'] = high === null ? no('insufficient_history') : ok(high.price);
    out['structure.swing_low_12h'] = low === null ? no('insufficient_history') : ok(low.price);
    out['structure.impulse_low_15m'] = impulse === null ? no('insufficient_history') : ok(impulse.price);
  }

  if (input.bars24h.length === 0 || input.closes24h.length !== input.bars24h.length) {
    out['structure.failed_highs_24h'] = no('no_data');
  } else if (input.atr1h === null) {
    // the distance is defined as a multiple of ATR(1h); without it there is no band to test
    out['structure.failed_highs_24h'] = no('insufficient_history');
  } else {
    const windowHigh = Math.max(...input.bars24h.map((b) => b.high));
    const band = atrMultiple * input.atr1h;
    const failed = pivotHighs(input.bars24h).filter((pivot) =>
      pivot.price >= windowHigh - band && (input.closes24h[pivot.index] as number) < windowHigh);
    out['structure.failed_highs_24h'] = ok(failed.length);
  }
  return out;
}

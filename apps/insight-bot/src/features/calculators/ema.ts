import { featureParamNumber, type WebFeatureKey, type WebFeatureValue } from '@trade-automation/contracts';
import { emaLast } from '../math/ema';

/**
 * IB-016 — the two trend EMAs of §8.2, pure.
 *
 * Specified by dev-1 for `regime`'s trend axis, which reads `ema.4h.50` at this frame, the same
 * key six frames back, and `ema.1d.200` against the close. Only the values live here; the axis
 * itself is dev-1's.
 *
 * **Both refuse rather than shorten.** `ema.1d.200` needs 200 daily bars and `candles_agg` holds
 * about ten, so on today's tape it refuses with `insufficient_history` on every symbol, and
 * `ema.4h.50` refuses on all but BTCUSDT. That is the archive backfill's prerequisite, stated in
 * advance, not a defect — and it is the right answer: a 200-day average over ten days of data is
 * a number that would make `trend` claim a direction nobody has evidence for.
 */

const ok = (value: number): WebFeatureValue => ({ ok: true, value });
const no = (why: 'insufficient_history'): WebFeatureValue => ({ ok: false, why });

export interface EmaInput {
  /** Closes of the complete 4h bars in the window, oldest first. */
  closes4h: readonly number[];
  /** Closes of the complete 1d bars in the window, oldest first. */
  closes1d: readonly number[];
}

export function emaFeatures(input: EmaInput): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const out: Partial<Record<WebFeatureKey, WebFeatureValue>> = {};

  // Lengths read from the registry rather than written here, so the key's name, its parameter
  // and the number actually used cannot drift apart.
  const length4h = featureParamNumber('ema.4h.50', 'length');
  const length1d = featureParamNumber('ema.1d.200', 'length');

  const e4h = emaLast(input.closes4h, length4h);
  out['ema.4h.50'] = e4h === null ? no('insufficient_history') : ok(e4h);

  const e1d = emaLast(input.closes1d, length1d);
  out['ema.1d.200'] = e1d === null ? no('insufficient_history') : ok(e1d);

  return out;
}

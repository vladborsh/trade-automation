import { featureParamNumber, type WebFeatureKey, type WebFeatureValue } from '@trade-automation/contracts';

/**
 * IB-015 — the open-interest group of §8.2, pure.
 *
 * Four keys: OI at the frame close, its 24 h and 4 h percent change, and whether it is at a
 * 7-day high.
 *
 * **A delta across a collection gap is not a flat market.** The caller hands over the slot it
 * found at each reference time, or `null` when none was stored; a missing reference refuses the
 * delta rather than measuring from the nearest slot it can find, because "the nearest slot" on a
 * day with an outage is an arbitrary distance away and the resulting percentage looks ordinary.
 */

const ok = (value: number | boolean): WebFeatureValue => ({ ok: true, value });
const no = (why: 'no_data' | 'insufficient_history'): WebFeatureValue => ({ ok: false, why });

export interface OiPoint {
  timeSec: number;
  /** Base-units open interest. */
  value: number;
}

export interface OiInput {
  /** The slot at the frame close, or null when none was stored for it. */
  now: OiPoint | null;
  /** The slot nearest 24 h / 4 h before the close, already matched by the caller, or null. */
  ago24h: OiPoint | null;
  ago4h: OiPoint | null;
  /** Every slot in the trailing 7 days, for the high. Empty when nothing is stored. */
  sevenDays: readonly OiPoint[];
}

/**
 * Percent change, or a refusal.
 *
 * A zero reference is refused rather than divided by: open interest of exactly zero is a real
 * state (a delisted or brand-new contract) and `(x - 0) / 0` is not a percentage.
 */
function pctChange(now: number, before: number | null): WebFeatureValue {
  if (before === null) return no('no_data');
  if (before === 0) return no('insufficient_history');
  return ok(((now - before) / before) * 100);
}

export function openInterestFeatures(input: OiInput): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const out: Partial<Record<WebFeatureKey, WebFeatureValue>> = {};
  const now = input.now;

  out['oi.binance.now'] = now === null ? no('no_data') : ok(now.value);
  out['oi.d24h_pct'] = now === null ? no('no_data') : pctChange(now.value, input.ago24h?.value ?? null);
  out['oi.d4h_pct'] = now === null ? no('no_data') : pctChange(now.value, input.ago4h?.value ?? null);

  if (now === null || input.sevenDays.length === 0) {
    out['oi.at_7d_high'] = no('no_data');
  } else {
    // "at or above" per §8.2, so the day it sets the high reads true rather than just-missing it
    const high = Math.max(...input.sevenDays.map((p) => p.value));
    out['oi.at_7d_high'] = ok(now.value >= high);
  }

  // referenced so the windows cannot drift from the registry (they are inside the fingerprint)
  void featureParamNumber('oi.d24h_pct', 'hours');
  return out;
}

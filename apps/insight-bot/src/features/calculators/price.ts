import type { WebFeatureKey, WebFeatureValue } from '@trade-automation/contracts';

/**
 * IB-015 — the price-context group of §8.2, pure. Three keys: the 24 h and 4 h return, and the
 * drawdown from the 24 h high.
 *
 * Every one needs a REFERENCE price, and a missing reference refuses rather than reaching for
 * the nearest bar it can find: across an outage the nearest bar is an arbitrary distance away
 * and the resulting percentage looks like an ordinary move.
 */

const ok = (value: number): WebFeatureValue => ({ ok: true, value });
const no = (why: 'no_data' | 'insufficient_history'): WebFeatureValue => ({ ok: false, why });

export interface PriceInput {
  /** Close at the frame close. */
  close: number | null;
  /** Close 24 h / 4 h before it, or null when that bar is not stored. */
  close24hAgo: number | null;
  close4hAgo: number | null;
  /** Highest high over the trailing 24 h, or null when nothing is stored. */
  high24h: number | null;
}

function ret(now: number, before: number | null): WebFeatureValue {
  if (before === null) return no('no_data');
  // a reference of zero is not a price; refusing beats an infinite return
  if (before === 0) return no('insufficient_history');
  return ok(((now - before) / before) * 100);
}

export function priceFeatures(input: PriceInput): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const out: Partial<Record<WebFeatureKey, WebFeatureValue>> = {};

  // IB-016: the close as a key in its own right. `no_data` rather than a refusal reason about
  // history — if the frame bar has no close, the bar is not there at all.
  out['px.close'] = input.close === null ? { ok: false, why: 'no_data' } : { ok: true, value: input.close };
  const close = input.close;

  out['px.ret_24h'] = close === null ? no('no_data') : ret(close, input.close24hAgo);
  out['px.ret_4h'] = close === null ? no('no_data') : ret(close, input.close4hAgo);

  if (close === null || input.high24h === null) {
    out['px.drawdown_from_24h_high'] = no('no_data');
  } else if (input.high24h === 0) {
    out['px.drawdown_from_24h_high'] = no('insufficient_history');
  } else {
    // negative or zero: at the high it is 0, which is a measurement and not an absence
    out['px.drawdown_from_24h_high'] = ok(((close - input.high24h) / input.high24h) * 100);
  }
  return out;
}

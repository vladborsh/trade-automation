import { MetricObservation } from '@trade-automation/contracts';
import { TipPrice } from './metric-adapter.port';

/**
 * architecture/chart-layouts.md §11.1 "The live tip" — a derived notional uses a price only if
 * it is stamped within this window of the snapshot's venue `time`. Further away and the price
 * no longer describes the snapshot instant: no notional at all, never an old price.
 */
export const TIP_PRICE_MAX_AGE_MS = 120_000;

/** The live poll's price (premiumIndex), if its `time` lies within 120 s of `time`, else `null`. */
export function acceptTipPrice(price: TipPrice | null, time: number): number | null {
  if (price === null || !Number.isFinite(price.price) || price.price <= 0) return null;
  return Math.abs(price.time - time) <= TIP_PRICE_MAX_AGE_MS ? price.price : null;
}

/**
 * For the legacy-row repair: the latest point of an ascending price history (1m mark-price
 * bars, stamped at their close) with `time` in `[time − TIP_PRICE_MAX_AGE_MS, time]` — never a
 * price from after the snapshot — or `null`. Binary search, so the repair can call it once per
 * row over 30 days of bars.
 */
export function tipPriceAt(points: readonly TipPrice[], time: number): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= time) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0 || points[idx].time < time - TIP_PRICE_MAX_AGE_MS) return null;
  return points[idx].price;
}

/** `observation` with `notional = value × price`, basis 'derived' (§11.1). */
export function withDerivedNotional(observation: MetricObservation, price: number): MetricObservation {
  return { ...observation, notional: observation.value * price, notionalBasis: 'derived' };
}

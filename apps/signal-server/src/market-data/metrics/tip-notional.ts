import { Candle, MetricObservation, TIMEFRAME_MS } from '@trade-automation/contracts';

const ONE_MINUTE_MS = TIMEFRAME_MS['1m'];

/**
 * architecture/chart-layouts.md §11.1 "The live tip" — a derived notional uses a 1m close only
 * if that bar closed within this window *before* the snapshot's venue `time` (never after it).
 * Older than this and the price no longer describes the snapshot instant: no notional at all,
 * never an old price.
 */
export const TIP_PRICE_MAX_AGE_MS = 120_000;

/**
 * The close of the most recent *closed* 1m candle whose close time (`openTime + 1m`) lies in
 * `[time − TIP_PRICE_MAX_AGE_MS, time]`, or `null` if none qualifies. `candles` must be one
 * instrument's 1m bars, ascending by `openTime` (what `CandleCache.query` / `CandleStore.query`
 * return). Binary search, so the boot-time repair can call it once per row over 30 days of bars.
 */
export function tipPriceAt(candles: readonly Candle[], time: number): number | null {
  // Index of the last bar with closeTime <= time.
  let lo = 0;
  let hi = candles.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].openTime + ONE_MINUTE_MS <= time) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (let i = idx; i >= 0; i--) {
    const c = candles[i];
    if (c.openTime + ONE_MINUTE_MS < time - TIP_PRICE_MAX_AGE_MS) break;
    if (c.closed) return c.close;
  }
  return null;
}

/** `observation` with `notional = value × price`, basis 'derived' (§11.1). */
export function withDerivedNotional(observation: MetricObservation, price: number): MetricObservation {
  return { ...observation, notional: observation.value * price, notionalBasis: 'derived' };
}

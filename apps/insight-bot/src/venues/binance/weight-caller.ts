import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * IB-147 — which part of the app a Binance request is spent for, without threading an argument through every layer
 * between an entry point (a loop's tick, a page's service, a collector) and the shared clients (`candles.service`,
 * `PerpRest`, …) that make the request. The entry point runs its work inside `withWeightCaller('positioning', …)`; the
 * weight tracker reads the caller when the request is booked (`BinanceWeightTracker.recordCall`). A request made
 * outside any caller is booked as `unattributed`, which the per-caller counter then shows instead of hiding.
 */
export const WEIGHT_CALLERS = [
  'chart', 'positioning', 'universe_summary', 'market_funding', 'level_alerts', 'oi_alerts', 'funding_alerts', 'news_reaction',
  'perp_collector', 'oi_ls_poller', 'exchange_info', 'insights', 'unattributed',
] as const;
export type WeightCaller = (typeof WEIGHT_CALLERS)[number];

const store = new AsyncLocalStorage<WeightCaller>();

/** Runs `fn` with every Binance request inside it booked to `caller` (the innermost caller wins). */
export function withWeightCaller<T>(caller: WeightCaller, fn: () => T): T {
  return store.run(caller, fn);
}

/** The caller of the request being booked now. */
export function currentWeightCaller(): WeightCaller {
  return store.getStore() ?? 'unattributed';
}

/**
 * A method decorator: the method's Binance requests (its whole async chain) are booked to `caller`. On an entry point:
 * a loop's tick, a page service's public method, a collector's poll.
 */
export function SpendsWeightAs(caller: WeightCaller) {
  return (_target: object, _key: string | symbol, descriptor: PropertyDescriptor): void => {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    descriptor.value = function wrapped(this: unknown, ...args: unknown[]) {
      return withWeightCaller(caller, () => original.apply(this, args));
    };
  };
}

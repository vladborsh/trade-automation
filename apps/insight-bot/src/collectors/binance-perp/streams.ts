/**
 * IB-006 — perp-shaped, so it stayed behind when the socket moved to `binance-common`: only the
 * USD-M collector wants the two array streams beside its klines. Spot's list is just the klines
 * (`spotStreamNames`).
 */
/** The stream names for one universe: a kline per symbol plus the two array streams (§4.1). */
export function perpStreamNames(symbols: readonly string[]): string[] {
  return [...symbols.map((s) => `${s.toLowerCase()}@kline_1m`), '!markPrice@arr@1s', '!forceOrder@arr'];
}

/**
 * IB-006 §4.2 — spot subscribes to one kline stream per symbol and nothing else: the perp's two
 * array streams (`!markPrice@arr@1s`, `!forceOrder@arr`) have no spot equivalent.
 */
export function spotStreamNames(symbols: readonly string[]): string[] {
  return symbols.map((s) => `${s.toLowerCase()}@kline_1m`);
}

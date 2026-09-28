/**
 * The `venue` value every Binance table row carries, shared by the perp (§4.1) and spot (§4.2)
 * collectors. One constant, because `candles_1m` keys on `(venue, market, symbol, open_time)` and
 * the two collectors differ only in `market`.
 */
export const VENUE = 'binance';

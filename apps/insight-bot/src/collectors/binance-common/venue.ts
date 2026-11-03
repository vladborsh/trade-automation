/**
 * The `venue` value every Binance table row carries, shared by the perp (§4.1) and spot (§4.2)
 * collectors. One constant, because the tables key on venue, market and symbol, and the two
 * collectors differ only in `market`.
 */
export const VENUE = 'binance';

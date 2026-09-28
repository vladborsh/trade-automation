/**
 * IB-006 done-line: **the spot kline websocket message is identical in shape to USD-M's.**
 *
 * Probed against the live spot socket on 2026-09-28
 * (`wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m`), the envelope
 * and the kline body are byte-for-byte the same shape as `fstream`'s:
 *
 * ```json
 * {"stream":"btcusdt@kline_1m","data":{"e":"kline","E":1790606126025,"s":"BTCUSDT",
 *  "k":{"t":1790606100000,"T":1790606159999,"s":"BTCUSDT","i":"1m","f":6719173683,"L":6719175948,
 *       "o":"83297.86000000","c":"83300.00000000","h":"83313.06000000","l":"83268.00000000",
 *       "v":"6.40970000","n":2266,"x":false,"q":"…","V":"…","Q":"…"}}}
 * ```
 *
 * So there is no spot variant of the parser: `binance-client`'s `mapWsKline` and its
 * `BinanceWsKlineMessage` type serve both markets, and `test/collectors/binance-spot/
 * payloads.spec.ts` holds that captured frame as the regression guard. The differences between
 * the two markets are elsewhere: the REST base and path (§4.2), the separate weight budget
 * (§4.5), and the streams perp has that spot does not (`streams.ts`).
 */
export {};

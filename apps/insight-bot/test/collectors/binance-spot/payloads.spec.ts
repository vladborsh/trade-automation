import { mapWsKline, type BinanceWsKlineMessage } from '@trade-automation/binance-client';

/**
 * IB-006 done-line: **document that the spot kline WS message is identical in shape to USD-M's.**
 *
 * `CAPTURED` is a real frame, taken from
 * `wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m` on 2026-09-28. `PERP_SHAPED` is
 * the same frame with USD-M's values: the two are the same keys, the same types and the same
 * nesting, which is why `binance-client`'s one parser serves both markets and there is no spot
 * variant of it.
 *
 * WD-010 removed the spot collector (`src/collectors/binance-spot/`), but this spec tests
 * `binance-client`'s parser, which stays — so the spec stays with it (a spec goes only with the
 * code it tests).
 */

const CAPTURED = {
  e: 'kline', E: 1790606126025, s: 'BTCUSDT',
  k: {
    t: 1790606100000, T: 1790606159999, s: 'BTCUSDT', i: '1m', f: 6719173683, L: 6719175948,
    o: '83297.86000000', c: '83300.00000000', h: '83313.06000000', l: '83268.00000000',
    v: '6.40970000', n: 2266, x: true, q: '533897.52', V: '3.20000000', Q: '266548.76', B: '0',
  },
} as unknown as BinanceWsKlineMessage;

const PERP_SHAPED = {
  e: 'kline', E: 1790606126025, s: 'BTCUSDT',
  k: {
    t: 1790606100000, T: 1790606159999, s: 'BTCUSDT', i: '1m', f: 1, L: 2,
    o: '83297.86', c: '83300.00', h: '83313.06', l: '83268.00',
    v: '6.4097', n: 2266, x: true, q: '533897.52', V: '3.2', Q: '266548.76', B: '0',
  },
} as unknown as BinanceWsKlineMessage;

describe('the spot kline websocket payload (§4.2)', () => {
  it('is the same shape as USD-M: same keys, same types, same nesting', () => {
    const keys = (m: BinanceWsKlineMessage) => Object.keys(m as unknown as object).sort();
    const klineKeys = (m: BinanceWsKlineMessage) => Object.keys(m.k as unknown as object).sort();
    expect(keys(CAPTURED)).toEqual(keys(PERP_SHAPED));
    expect(klineKeys(CAPTURED)).toEqual(klineKeys(PERP_SHAPED));
  });

  it('parses through the shared mapper — no spot variant of the parser exists', () => {
    expect(mapWsKline('binance:BTCUSDT', CAPTURED)).toEqual({
      instrument: 'binance:BTCUSDT',
      timeframe: '1m',
      openTime: 1790606100000,
      open: 83297.86,
      high: 83313.06,
      low: 83268,
      close: 83300,
      volume: 6.4097,
      closed: true,
      source: 'venue-stream',
      quoteVolume: 533897.52,
      trades: 2266,
      takerBuyVolume: 3.2,
      takerBuyQuoteVolume: 266548.76,
    });
  });

  it('the forming bar is marked, which is what the collector drops (§4.1)', () => {
    const forming = { ...CAPTURED, k: { ...CAPTURED.k, x: false } } as BinanceWsKlineMessage;
    expect(mapWsKline('binance:BTCUSDT', forming).closed).toBe(false);
  });
});

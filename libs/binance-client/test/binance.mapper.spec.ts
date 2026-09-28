import { mapRestKline, mapWsKline, BinanceRestKline, BinanceWsKlineMessage } from '../src/binance.mapper';

// Fixture shapes taken from Binance's real futures REST/WS payloads
// (https://binance-docs.github.io/apidocs/futures/en/#kline-candlestick-data,
// #websocket-market-streams kline stream), matching what cmc-bot-main's BinanceClient consumed.
describe('Binance payload mapping (architecture/live-signal-server.md §1, §4.1)', () => {
  it('maps a REST kline row using the exchange openTime, never Date.now()', () => {
    const row: BinanceRestKline = [
      1699000000000,
      '36000.10',
      '36050.00',
      '35990.50',
      '36020.25',
      '123.456',
      1699000059999,
      '4448000.00',
      321,
      '60.0',
      '2160000.00',
      '0',
    ];

    const candle = mapRestKline('binance:BTCUSDT', row);

    expect(candle).toEqual({
      instrument: 'binance:BTCUSDT',
      timeframe: '1m',
      openTime: 1699000000000,
      open: 36000.1,
      high: 36050.0,
      low: 35990.5,
      close: 36020.25,
      volume: 123.456,
      closed: true,
      source: 'venue-rest',
      // IB-002: the fixture's columns 7–10 are mapped as well
      quoteVolume: 4448000,
      trades: 321,
      takerBuyVolume: 60,
      takerBuyQuoteVolume: 2160000,
    });
  });

  it('maps a WS kline message, taking openTime from k.t and closed from k.x', () => {
    const forming: BinanceWsKlineMessage = {
      e: 'kline',
      E: 1699000030000,
      s: 'ETHUSDT',
      k: {
        t: 1699000000000,
        T: 1699000059999,
        s: 'ETHUSDT',
        i: '1m',
        o: '1800.00',
        h: '1802.50',
        l: '1799.00',
        c: '1801.25',
        v: '456.7',
        x: false,
      },
    };

    const candle = mapWsKline('binance:ETHUSDT', forming);

    expect(candle.openTime).toBe(1699000000000);
    expect(candle.openTime).not.toBe(forming.E); // must never fall back to the event/local clock
    expect(candle.closed).toBe(false);
    expect(candle.source).toBe('venue-stream');
    expect(candle.close).toBe(1801.25);
  });

  it('§12.5 item 3: maps a native coarse-timeframe kline with source venue-native, not venue-rest', () => {
    const row: BinanceRestKline = [
      1699000000000,
      '36000.10',
      '36050.00',
      '35990.50',
      '36020.25',
      '123.456',
      1699003599999,
      '4448000.00',
      321,
      '60.0',
      '2160000.00',
      '0',
    ];

    const candle = mapRestKline('binance:BTCUSDT', row, '1h');

    expect(candle.timeframe).toBe('1h');
    expect(candle.source).toBe('venue-native');
    expect(candle.openTime).toBe(1699000000000);
  });

  it('flips closed to true when the venue marks the kline final (x: true)', () => {
    const closed: BinanceWsKlineMessage = {
      e: 'kline',
      E: 1699000060000,
      s: 'ETHUSDT',
      k: {
        t: 1699000000000,
        T: 1699000059999,
        s: 'ETHUSDT',
        i: '1m',
        o: '1800.00',
        h: '1803.00',
        l: '1799.00',
        c: '1802.00',
        v: '500.0',
        x: true,
      },
    };

    expect(mapWsKline('binance:ETHUSDT', closed).closed).toBe(true);
  });
});

/**
 * IB-002 (insight-bot design §2.2, D3): the venue's activity fields on the Candle. Fixtures keep the
 * real payload shapes — USD-M futures and spot REST rows are 12 columns in the same order, and both
 * kline streams carry q / n / V / Q (futures adds B, spot adds B too; both are "ignore").
 */
describe('IB-002 activity fields (quote volume, trades, taker-buy base and quote)', () => {
  // GET /fapi/v1/klines, BTCUSDT 1m — columns 7–10 are the ones IB-002 maps
  const futuresRest: BinanceRestKline = [
    1727481600000, '65012.30', '65080.00', '64990.10', '65044.70', '318.421',
    1727481659999, '20707581.55', 4127, '171.884', '11180012.09', '0',
  ];
  // GET /api/v3/klines, BTCUSDT 1m — identical shape (design §4.2)
  const spotRest: BinanceRestKline = [
    1727481600000, '65010.01', '65077.99', '64988.00', '65043.11', '91.10422',
    1727481659999, '5924131.77', 8213, '47.55311', '3092008.41', '0',
  ];

  it('REST: maps columns 7–10 onto the candle, for futures and spot alike', () => {
    expect(mapRestKline('binance:BTCUSDT', futuresRest)).toMatchObject({
      volume: 318.421, quoteVolume: 20707581.55, trades: 4127, takerBuyVolume: 171.884, takerBuyQuoteVolume: 11180012.09,
    });
    expect(mapRestKline('binance:BTCUSDT', spotRest)).toMatchObject({
      volume: 91.10422, quoteVolume: 5924131.77, trades: 8213, takerBuyVolume: 47.55311, takerBuyQuoteVolume: 3092008.41,
    });
    // taker-sell is the complement — what §8.2's CVD is built from
    const c = mapRestKline('binance:BTCUSDT', futuresRest);
    expect(c.volume - (c.takerBuyVolume as number)).toBeCloseTo(146.537, 6);
  });

  it('REST: a coarse native kline carries them too, and nothing else changed', () => {
    const hourly = mapRestKline('binance:BTCUSDT', futuresRest, '1h');
    expect(hourly).toEqual({
      instrument: 'binance:BTCUSDT', timeframe: '1h', openTime: 1727481600000,
      open: 65012.3, high: 65080, low: 64990.1, close: 65044.7, volume: 318.421,
      closed: true, source: 'venue-native',
      quoteVolume: 20707581.55, trades: 4127, takerBuyVolume: 171.884, takerBuyQuoteVolume: 11180012.09,
    });
  });

  it('WS: maps q / n / V / Q from a futures kline message', () => {
    const msg: BinanceWsKlineMessage = {
      e: 'kline', E: 1727481659999, s: 'BTCUSDT',
      k: {
        t: 1727481600000, T: 1727481659999, s: 'BTCUSDT', i: '1m',
        o: '65012.30', c: '65044.70', h: '65080.00', l: '64990.10', v: '318.421', x: true,
        q: '20707581.55', n: 4127, V: '171.884', Q: '11180012.09',
      },
    };
    expect(mapWsKline('binance:BTCUSDT', msg)).toEqual({
      instrument: 'binance:BTCUSDT', timeframe: '1m', openTime: 1727481600000,
      open: 65012.3, high: 65080, low: 64990.1, close: 65044.7, volume: 318.421,
      closed: true, source: 'venue-stream',
      quoteVolume: 20707581.55, trades: 4127, takerBuyVolume: 171.884, takerBuyQuoteVolume: 11180012.09,
    });
  });

  it('WS: the spot kline message has the same fields, on a still-forming bar', () => {
    const msg: BinanceWsKlineMessage = {
      e: 'kline', E: 1727481630000, s: 'SOLUSDT',
      k: {
        t: 1727481600000, T: 1727481659999, s: 'SOLUSDT', i: '1m',
        o: '152.40', c: '152.55', h: '152.61', l: '152.31', v: '1204.33', x: false,
        q: '183564.21', n: 512, V: '701.02', Q: '106862.44',
      },
    };
    expect(mapWsKline('binance:SOLUSDT', msg)).toMatchObject({
      closed: false, quoteVolume: 183564.21, trades: 512, takerBuyVolume: 701.02, takerBuyQuoteVolume: 106862.44,
    });
  });

  it('a payload without them yields no keys at all — absent is not zero', () => {
    const msg: BinanceWsKlineMessage = {
      e: 'kline', E: 1727481659999, s: 'BTCUSDT',
      k: { t: 1727481600000, T: 1727481659999, s: 'BTCUSDT', i: '1m', o: '1', c: '1', h: '1', l: '1', v: '0', x: true },
    };
    const candle = mapWsKline('binance:BTCUSDT', msg);
    const present = ['quoteVolume', 'trades', 'takerBuyVolume', 'takerBuyQuoteVolume'].filter((k) => Object.hasOwn(candle, k));
    expect(present).toEqual([]);
  });
});

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

import {
  CandleSchema,
  Instrument,
  InstrumentSchema,
  Signal,
  SignalSchema,
  Candle,
} from '../src';

describe('contracts round-trip (architecture/live-signal-server.md §3)', () => {
  it('parses and re-serializes an Instrument identically', () => {
    const instrument: Instrument = {
      id: 'binance:BTCUSDT',
      venue: 'binance',
      symbol: 'BTCUSDT',
      assetClass: 'crypto-perp',
      displayName: 'BTC/USDT Perp',
      pricePrecision: 2,
      quoteCurrency: 'USDT',
      sessionTimezone: 'UTC',
    };
    const parsed = InstrumentSchema.parse(instrument);
    expect(parsed).toEqual(instrument);
    const reparsed = InstrumentSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(instrument);
  });

  it('rejects an InstrumentId with an unknown venue', () => {
    expect(() =>
      InstrumentSchema.parse({
        id: 'kraken:BTCUSDT',
        venue: 'binance',
        symbol: 'BTCUSDT',
        assetClass: 'crypto-perp',
        displayName: 'x',
        pricePrecision: 2,
        quoteCurrency: 'USDT',
        sessionTimezone: 'UTC',
      }),
    ).toThrow();
  });

  it('parses and re-serializes a CFD Candle with bid/ask retained', () => {
    const candle: Candle = {
      instrument: 'capitalcom:US100',
      timeframe: '1m',
      openTime: 1_726_000_000_000,
      open: 19000.5,
      high: 19005,
      low: 18995,
      close: 19001,
      volume: 0,
      closed: true,
      source: 'venue-rest',
      bid: { open: 19000, high: 19004.5, low: 18994.5, close: 19000.5 },
      ask: { open: 19001, high: 19005.5, low: 18995.5, close: 19001.5 },
    };
    const roundTripped = CandleSchema.parse(JSON.parse(JSON.stringify(CandleSchema.parse(candle))));
    expect(roundTripped).toEqual(candle);
  });

  it('parses a Signal with discriminated overlay primitives', () => {
    const signal: Signal = {
      id: '11111111-1111-1111-1111-111111111111',
      strategyId: 'example-cross',
      instrument: 'binance:ETHUSDT',
      timeframe: '1m',
      time: 1_726_000_000_000,
      kind: 'info',
      direction: 'flat',
      overlay: [
        { type: 'marker', time: 1_726_000_000_000, position: 'above', shape: 'circle' },
        { type: 'priceLine', price: 1800.5, style: 'dashed' },
      ],
      meta: { crossedUp: true, smaPeriod: 20 },
    };
    const parsed = SignalSchema.parse(JSON.parse(JSON.stringify(signal)));
    expect(parsed).toEqual(signal);
  });

  it('rejects a Candle missing required OHLC fields', () => {
    expect(() =>
      CandleSchema.parse({
        instrument: 'binance:BTCUSDT',
        timeframe: '1m',
        openTime: 1,
        open: 1,
        high: 1,
        low: 1,
        // close missing
        volume: 0,
        closed: true,
        source: 'venue-stream',
      }),
    ).toThrow();
  });
});

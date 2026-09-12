import {
  CandleSchema,
  Instrument,
  InstrumentSchema,
  Signal,
  SignalSchema,
  Candle,
  IndicatorPoint,
  IndicatorPointSchema,
  IndicatorSeriesSpec,
  IndicatorSeriesSpecSchema,
  StrategyRequirements,
  StrategyRequirementsSchema,
  WsIndicatorMessageSchema,
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
      tier: 'demo',
      kind: 'info',
      direction: 'flat',
      overlay: [
        { type: 'marker', time: 1_726_000_000_000, position: 'above', shape: 'circle' },
        { type: 'priceLine', price: 1800.5, style: 'dashed' },
        { type: 'line', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }], style: 'dashed' },
      ],
      meta: { crossedUp: true, smaPeriod: 20 },
    };
    const parsed = SignalSchema.parse(JSON.parse(JSON.stringify(signal)));
    expect(parsed).toEqual(signal);
  });

  it('rejects a Signal missing the required tier field (architecture/live-signal-server.md §11.1)', () => {
    expect(() =>
      SignalSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        strategyId: 'example-cross',
        instrument: 'binance:ETHUSDT',
        timeframe: '1m',
        time: 1,
        kind: 'info',
        direction: 'flat',
        overlay: [],
        meta: {},
      }),
    ).toThrow();
  });

  it('parses and re-serializes an IndicatorPoint (architecture/live-signal-server.md §11.3)', () => {
    const point: IndicatorPoint = {
      strategyId: 'vwap-band-reversal',
      instrument: 'capitalcom:US100',
      timeframe: '1m',
      tier: 'research',
      seriesId: 'vwap-band',
      time: 1_726_000_000_000,
      values: { vwap: 19000.5, vwapTop: 19010.2, vwapBottom: null },
    };
    const parsed = IndicatorPointSchema.parse(JSON.parse(JSON.stringify(point)));
    expect(parsed).toEqual(point);

    const frame = WsIndicatorMessageSchema.parse({ type: 'indicator', point });
    expect(frame.point).toEqual(point);
  });

  it('parses an IndicatorSeriesSpec with per-key style', () => {
    const spec: IndicatorSeriesSpec = {
      id: 'vwap-band',
      label: 'VWAP band (research, unvalidated)',
      scale: 'price',
      keys: [
        { key: 'vwap', label: 'VWAP', color: '#d29922' },
        { key: 'vwapTop', label: 'VWAP +1σ', color: '#d29922', style: 'dashed' },
      ],
    };
    expect(IndicatorSeriesSpecSchema.parse(spec)).toEqual(spec);
  });

  it('StrategyRequirements accepts optional minBars distinct from warmupBars', () => {
    const requirements: StrategyRequirements = {
      instruments: ['capitalcom:US100'],
      timeframe: '1m',
      warmupBars: { '1m': 1440 },
      minBars: { '1m': 1 },
      indicators: [{ id: 'vwap-band', label: 'VWAP band', scale: 'price', keys: [{ key: 'vwap', label: 'VWAP' }] }],
    };
    const parsed = StrategyRequirementsSchema.parse(requirements);
    expect(parsed.minBars).toEqual({ '1m': 1 });
    expect(parsed.warmupBars).toEqual({ '1m': 1440 });
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

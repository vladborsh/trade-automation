import { Candle, Instrument, Timeframe, VENDOR_FLOOR_DATE_HEADER, VENDOR_FLOOR_REACHED_HEADER } from '@trade-automation/contracts';
import { CandlesController } from '../../src/api/rest/candles.controller';
import { CandleCache } from '../../src/market-data/candle-cache.service';
import { CapComPriceNotFoundError } from '../../src/market-data/capitalcom/capitalcom.adapter';
import { VenueAdapter } from '../../src/market-data/venue-adapter.port';

const binanceInstrument: Instrument = {
  id: 'binance:BTCUSDT',
  venue: 'binance',
  symbol: 'BTCUSDT',
  assetClass: 'crypto-perp',
  displayName: 'BTC',
  pricePrecision: 2,
  quoteCurrency: 'USDT',
  sessionCurrency: 'USDT',
  sessionTimezone: 'UTC',
};

const capComInstrument: Instrument = {
  id: 'capitalcom:US100',
  venue: 'capitalcom',
  symbol: 'US100',
  assetClass: 'index-cfd',
  displayName: 'US100',
  pricePrecision: 1,
  quoteCurrency: 'USD',
  sessionCurrency: 'USD',
  sessionTimezone: 'UTC',
};

function bar(instrument: Instrument, openTime: number, tf: Timeframe = '1m'): Candle {
  return {
    instrument: instrument.id,
    timeframe: tf,
    openTime,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
    closed: true,
    source: 'venue-native',
  };
}

function fakeRes() {
  const headers = new Map<string, string>();
  return { setHeader: (k: string, v: string) => headers.set(k, v), headers };
}

function buildController(opts: {
  instruments: Instrument[];
  adapters: Map<string, VenueAdapter>;
  storeQuery?: jest.Mock;
  storeUpsert?: jest.Mock;
}) {
  const cache = new CandleCache();
  const config = { instruments: opts.instruments } as never;
  const store = {
    query: opts.storeQuery ?? jest.fn(async () => []),
    upsert: opts.storeUpsert ?? jest.fn(async () => undefined),
    latestOpenTime: jest.fn(async () => null),
    stream: async function* () {},
  };
  const controller = new CandlesController(config, cache, store as never, opts.adapters as never);
  return { controller, cache, store };
}

describe('GET /api/candles on-demand fetch-and-persist (architecture/live-signal-server.md §12.2/§12.5 item 4)', () => {
  it('Binance: always attempts an on-demand fetch on a genuine store-miss and persists the result', async () => {
    const fetchCandles = jest.fn(async () => [bar(binanceInstrument, 1_000, '1h')]);
    const adapter: VenueAdapter = {
      venue: 'binance',
      fetchCandles,
      streamCandles: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
      health: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
    };
    const { controller, store } = buildController({
      instruments: [binanceInstrument],
      adapters: new Map([['binance', adapter]]),
    });

    const res = fakeRes();
    const result = await controller.get(
      { instrument: binanceInstrument.id, timeframe: '1h', from: 0, to: 100_000, limit: 1500 } as never,
      res as never,
    );

    expect(fetchCandles).toHaveBeenCalledWith(binanceInstrument, '1h', 0, expect.any(Number));
    expect(store.upsert).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(res.headers.has(VENDOR_FLOOR_REACHED_HEADER)).toBe(false);
  });

  it('does not re-fetch when the cache/store already covers the requested range (no genuine miss)', async () => {
    const fetchCandles = jest.fn();
    const adapter: VenueAdapter = {
      venue: 'binance',
      fetchCandles,
      streamCandles: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
      health: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
    };
    const { controller, cache } = buildController({
      instruments: [binanceInstrument],
      adapters: new Map([['binance', adapter]]),
    });
    cache.upsert(bar(binanceInstrument, 1_000, '1h'));

    await controller.get(
      { instrument: binanceInstrument.id, timeframe: '1h', from: 1_000, to: 1_000, limit: 1500 } as never,
      fakeRes() as never,
    );

    expect(fetchCandles).not.toHaveBeenCalled();
  });

  it('Capital.com: skips the fetch entirely and signals the vendor floor for a pre-2024-01-02 intraday request', async () => {
    const fetchCandles = jest.fn();
    const adapter: VenueAdapter = {
      venue: 'capitalcom',
      fetchCandles,
      streamCandles: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
      health: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
    };
    const { controller } = buildController({
      instruments: [capComInstrument],
      adapters: new Map([['capitalcom', adapter]]),
    });

    const res = fakeRes();
    const from = Date.parse('2023-06-01T00:00:00Z'); // well before the confirmed 2024-01-02 floor
    const result = await controller.get(
      { instrument: capComInstrument.id, timeframe: '1m', from, to: from + 60_000, limit: 1500 } as never,
      res as never,
    );

    expect(fetchCandles).not.toHaveBeenCalled(); // §12.2: "don't bother trying"
    expect(result).toEqual([]);
    expect(res.headers.get(VENDOR_FLOOR_REACHED_HEADER)).toBe('true');
    expect(res.headers.get(VENDOR_FLOOR_DATE_HEADER)).toBe('2024-01-02T00:00:00.000Z');
  });

  it('Capital.com: attempts 1h/4h/1d (deeper, unconfirmed floor) and signals the floor on a 404 instead of throwing', async () => {
    const fetchCandles = jest.fn(async () => {
      throw new CapComPriceNotFoundError('no data this far back');
    });
    const adapter: VenueAdapter = {
      venue: 'capitalcom',
      fetchCandles,
      streamCandles: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
      health: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
    };
    const { controller } = buildController({
      instruments: [capComInstrument],
      adapters: new Map([['capitalcom', adapter]]),
    });

    const res = fakeRes();
    const from = Date.parse('2020-01-01T00:00:00Z');
    const result = await controller.get(
      { instrument: capComInstrument.id, timeframe: '1d', from, to: from + 86_400_000, limit: 1500 } as never,
      res as never,
    );

    expect(fetchCandles).toHaveBeenCalled();
    expect(result).toEqual([]);
    expect(res.headers.get(VENDOR_FLOOR_REACHED_HEADER)).toBe('true');
  });

  it('never masks a Binance adapter failure as an empty result', async () => {
    const adapter: VenueAdapter = {
      venue: 'binance',
      fetchCandles: jest.fn(async () => {
        throw new Error('Binance REST is down');
      }),
      streamCandles: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
      health: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
    };
    const { controller } = buildController({
      instruments: [binanceInstrument],
      adapters: new Map([['binance', adapter]]),
    });

    await expect(
      controller.get(
        { instrument: binanceInstrument.id, timeframe: '1h', from: 0, to: 100_000, limit: 1500 } as never,
        fakeRes() as never,
      ),
    ).rejects.toThrow('Binance REST is down');
  });
});

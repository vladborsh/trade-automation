import { Instrument } from '@trade-automation/contracts';
import { BinanceAdapter } from '../../src/market-data/binance/binance.adapter';
import { BinanceRestKline } from '../../src/market-data/binance/binance.mapper';

const instrument: Instrument = {
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

function kline(openTime: number, closeTime: number): BinanceRestKline {
  return [openTime, '100', '101', '99', '100.5', '10', closeTime, '1000', 5, '5', '500', '0'];
}

describe('BinanceAdapter.fetchCandles native coarse fetch (architecture/live-signal-server.md §12.5 item 3)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('sets `interval` to the requested timeframe and maps rows with source venue-native', async () => {
    const from = 1_700_000_000_000;
    const to = from + 3 * 60 * 60_000;
    const rows = [kline(from, from + 3_599_999), kline(from + 3_600_000, from + 7_199_999)];

    const fetchMock = jest.fn(async (url: URL) => {
      expect(url.searchParams.get('interval')).toBe('1h');
      return { ok: true, json: async () => rows } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example');
    const candles = await adapter.fetchCandles(instrument, '1h', from, to);

    expect(candles).toHaveLength(2);
    expect(candles.every((c) => c.timeframe === '1h' && c.source === 'venue-native')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // both rows fit in one REST_PAGE_LIMIT page
  });

  it('still maps 1m fetches with source venue-rest (unchanged default path)', async () => {
    const from = 1_700_000_000_000;
    const rows = [kline(from, from + 59_999)];
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => rows }) as Response) as unknown as typeof fetch;

    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example');
    const candles = await adapter.fetchCandles(instrument, '1m', from, from);

    expect(candles[0].source).toBe('venue-rest');
    expect(candles[0].timeframe).toBe('1m');
  });

  it('paginates using the requested timeframe\'s bar duration, not a hardcoded 1m step', async () => {
    const REST_PAGE_LIMIT = 1500;
    const from = 1_700_000_000_000;
    const HOUR = 60 * 60_000;
    const firstPage = Array.from({ length: REST_PAGE_LIMIT }, (_, i) =>
      kline(from + i * HOUR, from + i * HOUR + HOUR - 1),
    );
    const secondPage = [kline(from + REST_PAGE_LIMIT * HOUR, from + REST_PAGE_LIMIT * HOUR + HOUR - 1)];

    let call = 0;
    const fetchMock = jest.fn(async (url: URL) => {
      call += 1;
      expect(url.searchParams.get('interval')).toBe('1h');
      return { ok: true, json: async () => (call === 1 ? firstPage : secondPage) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example');
    const to = from + (REST_PAGE_LIMIT + 1) * HOUR;
    const candles = await adapter.fetchCandles(instrument, '1h', from, to);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(candles).toHaveLength(REST_PAGE_LIMIT + 1);
  });
});

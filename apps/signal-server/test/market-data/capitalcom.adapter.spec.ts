import { Instrument } from '@trade-automation/contracts';
import { CapComPriceNotFoundError, CapitalComAdapter } from '../../src/market-data/capitalcom/capitalcom.adapter';
import { CapComPriceRow } from '../../src/market-data/capitalcom/capitalcom.mapper';

const instrument: Instrument = {
  id: 'capitalcom:US100',
  venue: 'capitalcom',
  symbol: 'US100',
  assetClass: 'index-cfd',
  displayName: 'US100',
  pricePrecision: 1,
  quoteCurrency: 'USD',
  sessionTimezone: 'UTC',
};

function row(snapshotTimeUTC: string): CapComPriceRow {
  return {
    snapshotTime: snapshotTimeUTC,
    snapshotTimeUTC,
    openPrice: { bid: 100, ask: 100.2 },
    highPrice: { bid: 101, ask: 101.2 },
    lowPrice: { bid: 99, ask: 99.2 },
    closePrice: { bid: 100.5, ask: 100.7 },
    lastTradedVolume: 0,
  };
}

function fakeSession() {
  return { authHeaders: jest.fn(async () => ({ 'X-CAP-API-KEY': 'k' })) } as never;
}

describe('CapitalComAdapter.fetchCandles native coarse fetch (architecture/live-signal-server.md §12.4/§12.5 item 3)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('sets `resolution` to the CAP_COM_RESOLUTION value for the requested timeframe and maps rows as venue-native', async () => {
    const rows = [row('2024-01-02T00:00:00'), row('2024-01-03T00:00:00')];
    const fetchMock = jest.fn(async (url: URL) => {
      expect(url.searchParams.get('resolution')).toBe('DAY');
      return { ok: true, status: 200, json: async () => ({ prices: rows, instrumentType: 'INDICES' }) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new CapitalComAdapter('https://api-capital.example', fakeSession());
    const from = Date.parse('2024-01-02T00:00:00Z');
    const to = Date.parse('2024-01-03T00:00:00Z');
    const candles = await adapter.fetchCandles(instrument, '1d', from, to);

    expect(candles).toHaveLength(2);
    expect(candles.every((c) => c.timeframe === '1d' && c.source === 'venue-native')).toBe(true);
  });

  it('sets `resolution` to HOUR_4 for 4h (not independently re-verified live — corroborated by cmc-bot-main, §12.4)', async () => {
    const fetchMock = jest.fn(async (url: URL) => {
      expect(url.searchParams.get('resolution')).toBe('HOUR_4');
      return { ok: true, status: 200, json: async () => ({ prices: [], instrumentType: 'INDICES' }) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new CapitalComAdapter('https://api-capital.example', fakeSession());
    await adapter.fetchCandles(instrument, '4h', 0, 60 * 60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('§12.2/§12.4 vendor floor: a 404 becomes CapComPriceNotFoundError, not a generic Error', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }) as Response) as unknown as typeof fetch;

    const adapter = new CapitalComAdapter('https://api-capital.example', fakeSession());

    await expect(adapter.fetchCandles(instrument, '1m', 0, 60_000)).rejects.toBeInstanceOf(CapComPriceNotFoundError);
  });

  it('surfaces a non-404 failure as a plain Error (never silently swallowed as a floor)', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' }) as Response,
    ) as unknown as typeof fetch;

    const adapter = new CapitalComAdapter('https://api-capital.example', fakeSession());

    await expect(adapter.fetchCandles(instrument, '1h', 0, 60 * 60_000)).rejects.not.toBeInstanceOf(
      CapComPriceNotFoundError,
    );
  });
});

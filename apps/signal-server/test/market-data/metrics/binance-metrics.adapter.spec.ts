import { Instrument } from '@trade-automation/contracts';
import { BinanceMetricsAdapter } from '../../../src/market-data/metrics/binance/binance-metrics.adapter';
import { BinanceOpenInterestHistRow } from '../../../src/market-data/metrics/binance/binance-metrics.mapper';

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

const PERIOD_MS = 5 * 60_000;
const PAGE_LIMIT = 500;

function row(timestamp: number): BinanceOpenInterestHistRow {
  return {
    symbol: instrument.symbol,
    sumOpenInterest: '100',
    sumOpenInterestValue: '5000000',
    timestamp,
  };
}

/**
 * A fake `fetch` over a synthetic 5m-aligned series that mimics the venue's real (and, until
 * this fix, unmodelled) semantics: given `[startTime, endTime]`, it returns the **newest**
 * `limit` rows inside that window, ascending — never the oldest. This is the fake the
 * architecture note (Bug 2, defect 1) says would have caught the forward-pagination bug on the
 * day it shipped; a fake that returned oldest-first would pass against the broken adapter and
 * prove nothing.
 */
function newestFirstFakeFetch(seriesStart: number, seriesEnd: number) {
  const calls: URL[] = [];
  const fetchMock = jest.fn(async (url: URL) => {
    calls.push(url);
    const startTime = Number(url.searchParams.get('startTime'));
    const endTime = Number(url.searchParams.get('endTime'));
    const limit = Number(url.searchParams.get('limit'));

    const windowStart = Math.max(seriesStart, startTime);
    const windowEnd = Math.min(seriesEnd, endTime);
    if (windowStart > windowEnd) return { ok: true, json: async () => [] } as Response;

    const allTimestampsInWindow: number[] = [];
    for (let t = windowStart; t <= windowEnd; t += PERIOD_MS) allTimestampsInWindow.push(t);

    // The newest `limit` rows of the window, still ascending.
    const rows = allTimestampsInWindow.slice(-limit).map(row);
    return { ok: true, json: async () => rows } as Response;
  });
  return { fetchMock, calls };
}

describe(
  'BinanceMetricsAdapter.fetchObservations pagination ' +
    '(architecture/panel-sync-and-oi-depth-diagnosis.md, Bug 2, defect 1)',
  () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
      jest.restoreAllMocks();
    });

    it('returns the full ascending, gapless series across many pages against a newest-first venue', async () => {
      const now = 1_800_000_000_000; // fixed "now" so HIST_RETENTION_MS clamping is inert
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const days = 30;
      const seriesEnd = now;
      const seriesStart = now - days * 24 * 60 * 60_000;

      const { fetchMock } = newestFirstFakeFetch(seriesStart, seriesEnd);
      global.fetch = fetchMock as unknown as typeof fetch;

      const adapter = new BinanceMetricsAdapter('https://fapi.example');
      const observations = await adapter.fetchObservations(instrument, 'openInterest', seriesStart, seriesEnd);

      const expectedCount = Math.floor((seriesEnd - seriesStart) / PERIOD_MS) + 1;
      expect(observations).toHaveLength(expectedCount);

      // Ascending, no gaps, no duplicates.
      for (let i = 1; i < observations.length; i++) {
        expect(observations[i].time - observations[i - 1].time).toBe(PERIOD_MS);
      }
      expect(observations[0].time).toBe(seriesStart);
      expect(observations[observations.length - 1].time).toBe(seriesEnd);

      // 30 days at 5m is 8,640 rows; 500/page => at least 18 requests.
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(Math.ceil(expectedCount / PAGE_LIMIT));

      // The forward-pagination bug returns in exactly one page, however wide the window —
      // guard the regression directly.
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    });

    it('returns in one call when the window is narrower than one page', async () => {
      const now = 1_800_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const seriesStart = now - 10 * PERIOD_MS;
      const seriesEnd = now;
      const { fetchMock } = newestFirstFakeFetch(seriesStart, seriesEnd);
      global.fetch = fetchMock as unknown as typeof fetch;

      const adapter = new BinanceMetricsAdapter('https://fapi.example');
      const observations = await adapter.fetchObservations(instrument, 'openInterest', seriesStart, seriesEnd);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(observations).toHaveLength(11);
      expect(observations[0].time).toBe(seriesStart);
      expect(observations[observations.length - 1].time).toBe(seriesEnd);
    });

    it(
      'a forward-paginating implementation would have failed this: single-page result covers ' +
        'only the newest slice of a wide window',
      async () => {
        // Documents the exact live symptom from the diagnosis note (500 rows x 5m = 41h40m)
        // by asserting what the FIXED adapter must NOT do: settle for one page over 30 days.
        const now = 1_800_000_000_000;
        jest.spyOn(Date, 'now').mockReturnValue(now);
        const seriesStart = now - 30 * 24 * 60 * 60_000;
        const seriesEnd = now;
        const { fetchMock } = newestFirstFakeFetch(seriesStart, seriesEnd);
        global.fetch = fetchMock as unknown as typeof fetch;

        const adapter = new BinanceMetricsAdapter('https://fapi.example');
        const observations = await adapter.fetchObservations(instrument, 'openInterest', seriesStart, seriesEnd);

        const onePageSpanMs = observations[observations.length - 1].time - observations[0].time;
        expect(onePageSpanMs).toBeGreaterThan(PAGE_LIMIT * PERIOD_MS);
      },
    );
  },
);

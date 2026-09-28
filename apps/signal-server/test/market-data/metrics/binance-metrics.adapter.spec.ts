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
  sessionCurrency: 'USDT',
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

    it('BUG-022: treats -1130 as the retention wall and keeps what it already fetched', async () => {
      // Re-measured 2026-09-28: BOTH startTime and endTime are validated against a window that
      // DRIFTS (now-31d was rejected at 21:01 and accepted at 21:04). So a page that was inside
      // the window when the clamp was computed can be outside it by the time it is requested.
      // Before this fix any non-2xx threw, losing an entire backfill to a moving boundary.
      const now = 1_800_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      const seriesEnd = now - PERIOD_MS;
      const seriesStart = seriesEnd - 600 * PERIOD_MS;

      let call = 0;
      global.fetch = jest.fn(async (url: URL) => {
        call += 1;
        if (call === 1) {
          const endTime = Number(url.searchParams.get('endTime'));
          const times: number[] = [];
          for (let t = Math.max(seriesStart, endTime - 499 * PERIOD_MS); t <= Math.min(seriesEnd, endTime); t += PERIOD_MS) times.push(t);
          return { ok: true, json: async () => times.map(row) } as Response;
        }
        // The second page falls off the drifting edge.
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () => '{"msg":"parameter \'endTime\' is invalid.","code":-1130}',
        } as Response;
      }) as never;

      const adapter = new BinanceMetricsAdapter('https://fapi.binance.com');
      const out = await adapter.fetchObservations(instrument, 'openInterest', seriesStart, seriesEnd);

      // It kept page one rather than throwing it away.
      expect(out.length).toBeGreaterThan(0);
      expect(out).toEqual([...out].sort((a, b) => a.time - b.time));
    });

    it('BUG-022: a non-retention failure still throws — only -1130 is an ending', async () => {
      const now = 1_800_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 418,
        statusText: "I'm a teapot",
        text: async () => '{"msg":"banned","code":-1003}',
      })) as never;

      const adapter = new BinanceMetricsAdapter('https://fapi.binance.com');
      await expect(
        adapter.fetchObservations(instrument, 'openInterest', now - 3 * PERIOD_MS, now - PERIOD_MS),
      ).rejects.toThrow(/failed: 418/);
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

/** architecture/chart-layouts.md §11.1 — the tip price is the venue's mark price. */
describe('BinanceMetricsAdapter tip price (mark price)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const MIN = 60_000;
  const T = 1_800_000_000_000 - (1_800_000_000_000 % MIN);

  it('fetchTipPrice reads markPrice and the venue time from /fapi/v1/premiumIndex', async () => {
    const fetchMock = jest.fn(async (_url: URL) => ({
      ok: true,
      json: async () => ({ symbol: 'BTCUSDT', markPrice: '76385.12000000', indexPrice: '76390.1', time: T + 1_234 }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const price = await new BinanceMetricsAdapter('https://fapi.example').fetchTipPrice(instrument);

    expect(price).toEqual({ time: T + 1_234, price: 76385.12 });
    const url = fetchMock.mock.calls[0][0];
    expect(url.pathname).toBe('/fapi/v1/premiumIndex');
    expect(url.searchParams.get('symbol')).toBe('BTCUSDT');
  });

  it('fetchTipPrice throws on a non-OK response (the ingestion service turns that into "no notional")', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' })) as never;
    await expect(new BinanceMetricsAdapter('https://fapi.example').fetchTipPrice(instrument)).rejects.toThrow(
      'premiumIndex request failed: 503',
    );
  });

  /** Fake markPriceKlines over a gapless 1m series: bars with openTime in [startTime, endTime], ≤ limit. */
  function markKlinesFake() {
    return jest.fn(async (url: URL) => {
      const start = Number(url.searchParams.get('startTime'));
      const end = Number(url.searchParams.get('endTime'));
      const limit = Number(url.searchParams.get('limit'));
      const rows: unknown[] = [];
      for (let t = Math.ceil(start / MIN) * MIN; t <= end && rows.length < limit; t += MIN) {
        rows.push([t, '1', '1', '1', String(t / MIN), '0', t + MIN - 1]);
      }
      return { ok: true, json: async () => rows } as Response;
    });
  }

  it('fetchTipPriceHistory stamps each 1m mark bar at its close and covers every row with ≤ 30 pages for 30 days', async () => {
    const fetchMock = markKlinesFake();
    global.fetch = fetchMock as unknown as typeof fetch;
    const times: number[] = [];
    for (let t = T - 30 * 24 * 60 * MIN; t <= T; t += MIN) times.push(t + 1_500);

    const points = await new BinanceMetricsAdapter('https://fapi.example', 0).fetchTipPriceHistory(instrument, times);

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(30);
    expect(fetchMock.mock.calls[0][0].pathname).toBe('/fapi/v1/markPriceKlines');
    expect(fetchMock.mock.calls[0][0].searchParams.get('limit')).toBe('1500');
    // Point time = openTime + 1m; its price (the fake's close) is openTime / 1m.
    expect(points[0].price).toBe(points[0].time / MIN - 1);
    // Every row has the bar that closed at its minute boundary.
    const byTime = new Map(points.map((p) => [p.time, p.price]));
    for (const t of times) expect(byTime.has(t - 1_500)).toBe(true);
    for (let i = 1; i < points.length; i++) expect(points[i].time).toBeGreaterThan(points[i - 1].time);
  });

  it('fetchTipPriceHistory fetches only around sparse stretches — gaps between them cost nothing', async () => {
    const fetchMock = markKlinesFake();
    global.fetch = fetchMock as unknown as typeof fetch;
    const times = [T - 20 * 24 * 60 * MIN, T - 20 * 24 * 60 * MIN + MIN, T - 2 * 24 * 60 * MIN, T];

    await new BinanceMetricsAdapter('https://fapi.example', 0).fetchTipPriceHistory(instrument, times);

    // Three disjoint stretches → three pages (the last two rows are > 1500 min apart).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

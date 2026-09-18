import { Logger } from '@nestjs/common';
import { MetricSource } from '@trade-automation/contracts';
import {
  BYBIT_REQUEST_PACING_MS,
  BybitMetricsAdapter,
  BybitRateLimitError,
} from '../../../src/market-data/metrics/bybit/bybit-metrics.adapter';
import { buildMetricAdapters } from '../../../src/market-data/metric-adapters.provider';
import { MetricsService } from '../../../src/observability/metrics.service';

const source: MetricSource = { id: 'bybit:BTCUSDT', venue: 'bybit', symbol: 'BTCUSDT', quoteCurrency: 'USDT' };

const BAR_MS = 5 * 60_000;
const NOW = 1_800_000_000_000; // 5-min aligned
const OI_LIMIT = 200;
const KLINE_LIMIT = 1000;

const single = (t: number) => 20_000 + ((t / BAR_MS) % 997); // deterministic, distinct per row
const markClose = (barStart: number) => 60_000 + ((barStart / BAR_MS) % 991);

interface FakeVenueOptions {
  oiStart: number;
  oiEnd: number;
  /** Mark bars exist for start times in [markStart, markEnd]. */
  markStart?: number;
  markEnd?: number;
  /** Mark bar start times to omit (a venue gap). */
  markHoles?: Set<number>;
  /** Override the ratio openInterest / single on history rows. */
  ratio?: (t: number) => number;
  /** Per-call override: return a Response to short-circuit (e.g. a 403 on call N). */
  intercept?: (url: URL, call: number) => Response | undefined;
  venueTime?: number;
}

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => body } as Response;
}

/**
 * A fake Bybit that behaves like the real one (architecture/aggregate-oi.md §5): for
 * `[startTime, endTime]` it returns the NEWEST `limit` rows of the window, NEWEST FIRST — never
 * the oldest. A forward walker (advance startTime) gets the same newest page back every time and
 * fails the gapless assertions below: exactly how Bug 2 shipped.
 */
function fakeBybit(opts: FakeVenueOptions) {
  const calls: URL[] = [];
  const venueTime = opts.venueTime ?? NOW + 42_000;
  const fetchMock = jest.fn(async (url: URL) => {
    calls.push(url);
    const hit = opts.intercept?.(url, calls.length);
    if (hit) return hit;
    const p = url.searchParams;
    const limit = Number(p.get('limit'));
    if (url.pathname === '/v5/market/open-interest') {
      expect(p.get('intervalTime')).toBe('5min');
      expect(p.get('category')).toBe('linear');
      const lo = Math.max(opts.oiStart, Math.ceil(Number(p.get('startTime')) / BAR_MS) * BAR_MS);
      const hi = Math.min(opts.oiEnd, Number(p.get('endTime')));
      const stamps: number[] = [];
      for (let t = lo; t <= hi; t += BAR_MS) stamps.push(t);
      const list = stamps
        .slice(-limit)
        .reverse()
        .map((t) => ({
          openInterest: String(single(t) * (opts.ratio?.(t) ?? 2)),
          singleOpenInterest: String(single(t)),
          timestamp: String(t),
        }));
      return json({ retCode: 0, retMsg: 'OK', result: { symbol: 'BTCUSDT', category: 'linear', list }, time: venueTime });
    }
    if (url.pathname === '/v5/market/mark-price-kline') {
      expect(p.get('interval')).toBe('5');
      const lo = Math.max(opts.markStart ?? opts.oiStart - BAR_MS, Math.ceil(Number(p.get('start')) / BAR_MS) * BAR_MS);
      const hi = Math.min(opts.markEnd ?? opts.oiEnd, Number(p.get('end')));
      const starts: number[] = [];
      for (let t = lo; t <= hi; t += BAR_MS) if (!opts.markHoles?.has(t)) starts.push(t);
      const list = starts
        .slice(-limit)
        .reverse()
        .map((t) => [String(t), '0', '0', '0', String(markClose(t))]);
      return json({ retCode: 0, retMsg: 'OK', result: { symbol: 'BTCUSDT', category: 'linear', list }, time: venueTime });
    }
    if (url.pathname === '/v5/market/tickers') {
      return json({
        retCode: 0,
        retMsg: 'OK',
        result: {
          category: 'linear',
          list: [
            {
              symbol: 'BTCUSDT',
              markPrice: '78032.9',
              openInterest: '56714.412',
              singleOpenInterest: '28357.206',
              singleOpenInterestValue: '2212795020.08',
            },
          ],
        },
        time: venueTime,
      });
    }
    throw new Error(`unexpected ${url}`);
  });
  const byPath = (path: string) => calls.filter((u) => u.pathname === path);
  return { fetchMock, calls, byPath };
}

describe('BybitMetricsAdapter (architecture/aggregate-oi.md §4, §5, §7)', () => {
  const realFetch = global.fetch;
  const adapter = (extra: ConstructorParameters<typeof BybitMetricsAdapter>[1] = {}) =>
    new BybitMetricsAdapter('https://api.bybit.example', { pacingMs: 0, retCodeBackoffMs: 0, ...extra });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  describe('history pagination — backward, like the venue (§5 "Bybit pagination", Bug 2)', () => {
    it('returns every row ascending and gapless across many OI and mark-kline pages', async () => {
      const from = NOW - 5 * 24 * 60 * 60_000; // 5 days = 1441 rows → 8 OI pages, 2 kline pages
      const venue = fakeBybit({ oiStart: from - 30 * BAR_MS, oiEnd: NOW });
      global.fetch = venue.fetchMock as unknown as typeof fetch;

      const rows = await adapter().fetchObservations(source, 'openInterest', from, NOW);

      const n = (NOW - from) / BAR_MS + 1;
      expect(rows).toHaveLength(n);
      expect(rows[0].time).toBe(from);
      expect(rows[rows.length - 1].time).toBe(NOW);
      for (let i = 1; i < rows.length; i++) expect(rows[i].time - rows[i - 1].time).toBe(BAR_MS);
      expect(venue.byPath('/v5/market/open-interest').length).toBeGreaterThanOrEqual(Math.ceil(n / OI_LIMIT));
      expect(venue.byPath('/v5/market/mark-price-kline').length).toBeGreaterThanOrEqual(Math.ceil(n / KLINE_LIMIT));

      // §4: every row priced at the close of Bybit's own mark bar ENDING at its stamp.
      for (const o of rows) {
        expect(o.value).toBe(single(o.time));
        expect(o.unit).toBe('base');
        expect(o.notionalBasis).toBe('derived');
        expect(o.notional).toBeCloseTo(single(o.time) * markClose(o.time - BAR_MS), 6);
      }
    });

    it('each request shrinks endTime below the previous page and keeps startTime = from', async () => {
      const from = NOW - 2 * 24 * 60 * 60_000;
      const venue = fakeBybit({ oiStart: from - BAR_MS * 10, oiEnd: NOW });
      global.fetch = venue.fetchMock as unknown as typeof fetch;

      await adapter().fetchObservations(source, 'openInterest', from, NOW);

      const oi = venue.byPath('/v5/market/open-interest');
      expect(oi[0].searchParams.get('endTime')).toBe(String(NOW));
      for (let i = 1; i < oi.length; i++) {
        expect(oi[i].searchParams.get('startTime')).toBe(String(from));
        expect(Number(oi[i].searchParams.get('endTime'))).toBeLessThan(Number(oi[i - 1].searchParams.get('endTime')));
      }
    });

    it('a window narrower than one page is one OI call and one mark-kline call', async () => {
      const from = NOW - 100 * BAR_MS;
      const venue = fakeBybit({ oiStart: NOW - 1000 * BAR_MS, oiEnd: NOW });
      global.fetch = venue.fetchMock as unknown as typeof fetch;

      const rows = await adapter().fetchObservations(source, 'openInterest', from, NOW);

      expect(rows).toHaveLength(101);
      expect(venue.byPath('/v5/market/open-interest')).toHaveLength(1);
      expect(venue.byPath('/v5/market/mark-price-kline')).toHaveLength(1);
    });

    it('stops at the start of the venue history (short page) without further calls', async () => {
      const oiStart = NOW - 450 * BAR_MS; // 451 rows exist; ask for far more
      const venue = fakeBybit({ oiStart, oiEnd: NOW });
      global.fetch = venue.fetchMock as unknown as typeof fetch;

      const rows = await adapter().fetchObservations(source, 'openInterest', NOW - 3000 * BAR_MS, NOW);

      expect(rows).toHaveLength(451);
      expect(rows[0].time).toBe(oiStart);
      expect(venue.byPath('/v5/market/open-interest')).toHaveLength(3); // 200 + 200 + 51
    });

    it('no mark bar ending at a row stamp → that row has no notional, never a neighbour bar', async () => {
      const from = NOW - 20 * BAR_MS;
      const hole = NOW - 10 * BAR_MS; // bar starting here ends at NOW − 9 bars
      const venue = fakeBybit({ oiStart: from, oiEnd: NOW, markHoles: new Set([hole]) });
      global.fetch = venue.fetchMock as unknown as typeof fetch;

      const rows = await adapter().fetchObservations(source, 'openInterest', from, NOW);

      const unpriced = rows.filter((o) => o.notional === undefined).map((o) => o.time);
      expect(unpriced).toEqual([hole + BAR_MS]);
      expect(rows.find((o) => o.time === hole + BAR_MS)).toEqual({
        metric: 'openInterest',
        instrument: 'bybit:BTCUSDT',
        time: hole + BAR_MS,
        value: single(hole + BAR_MS),
        unit: 'base',
      });
    });

    it('drops a mark bar still forming at the venue time (its close is a live price)', async () => {
      // Venue time is mid-bar: the bar starting at NOW has not closed. Rows end at NOW, so no row
      // needs it — but the page must not smuggle it in as a closed bar either.
      const venue = fakeBybit({ oiStart: NOW - 5 * BAR_MS, oiEnd: NOW, markEnd: NOW, venueTime: NOW + 60_000 });
      global.fetch = venue.fetchMock as unknown as typeof fetch;

      const rows = await adapter().fetchObservations(source, 'openInterest', NOW - 5 * BAR_MS, NOW);
      expect(rows.every((o) => o.notional !== undefined)).toBe(true);
      const kline = venue.byPath('/v5/market/mark-price-kline')[0];
      expect(Number(kline.searchParams.get('end'))).toBeLessThanOrEqual(NOW - BAR_MS);
    });
  });

  it('live tip: tickers → single OI, singleOpenInterestValue (basis venue), the response time', async () => {
    const venue = fakeBybit({ oiStart: NOW, oiEnd: NOW, venueTime: 1_789_731_656_326 });
    global.fetch = venue.fetchMock as unknown as typeof fetch;

    const o = await adapter().fetchLatest(source, 'openInterest');

    expect(o).toEqual({
      metric: 'openInterest',
      instrument: 'bybit:BTCUSDT',
      time: 1_789_731_656_326,
      value: 28_357.206,
      unit: 'base',
      notional: 2_212_795_020.08,
      notionalBasis: 'venue',
    });
    expect(venue.calls).toHaveLength(1);
    expect(venue.calls[0].searchParams.get('category')).toBe('linear');
    expect(venue.calls[0].searchParams.get('symbol')).toBe('BTCUSDT');
  });

  describe('drift guard (§2)', () => {
    it('counts every drifting row per source and warns once per streak', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const drifted: string[] = [];
      // Rows NOW−9..NOW−5 bars drift (ratio 1 — the legacy field went one-sided), the rest are 2.
      const venue = fakeBybit({
        oiStart: NOW - 9 * BAR_MS,
        oiEnd: NOW,
        ratio: (t) => (t <= NOW - 5 * BAR_MS ? 1 : 2),
      });
      global.fetch = venue.fetchMock as unknown as typeof fetch;

      const rows = await adapter({ onSidednessDrift: (s) => drifted.push(s) }).fetchObservations(
        source,
        'openInterest',
        NOW - 9 * BAR_MS,
        NOW,
      );

      expect(drifted).toEqual(Array(5).fill('bybit:BTCUSDT'));
      expect(warn.mock.calls.filter(([m]) => String(m).includes('sidedness drift'))).toHaveLength(1);
      // The stored value is still the single side — the guard observes, it never rewrites.
      expect(rows.map((o) => o.value)).toEqual(rows.map((o) => single(o.time)));
    });
  });

  describe('rate-limit handling (§7)', () => {
    it('HTTP 403 → BybitRateLimitError immediately, no retry', async () => {
      const venue = fakeBybit({ oiStart: NOW - 1000 * BAR_MS, oiEnd: NOW, intercept: () => json({}, 403) });
      global.fetch = venue.fetchMock as unknown as typeof fetch;

      await expect(adapter().fetchObservations(source, 'openInterest', NOW - 500 * BAR_MS, NOW)).rejects.toBeInstanceOf(
        BybitRateLimitError,
      );
      expect(venue.calls).toHaveLength(1);
    });

    it('HTTP 429 on a later page stops the walk there', async () => {
      const venue = fakeBybit({
        oiStart: NOW - 1000 * BAR_MS,
        oiEnd: NOW,
        intercept: (_u, call) => (call === 2 ? json({}, 429) : undefined),
      });
      global.fetch = venue.fetchMock as unknown as typeof fetch;

      await expect(adapter().fetchObservations(source, 'openInterest', NOW - 900 * BAR_MS, NOW)).rejects.toBeInstanceOf(
        BybitRateLimitError,
      );
      expect(venue.calls).toHaveLength(2);
    });

    it('retCode != 0 → backs off once and retries; a second failure throws', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const bad = json({ retCode: 10006, retMsg: 'Too many visits', result: {}, time: NOW });
      const once = fakeBybit({ oiStart: NOW - 10 * BAR_MS, oiEnd: NOW, intercept: (_u, call) => (call === 1 ? bad : undefined) });
      global.fetch = once.fetchMock as unknown as typeof fetch;
      const rows = await adapter().fetchObservations(source, 'openInterest', NOW - 10 * BAR_MS, NOW);
      expect(rows).toHaveLength(11);
      expect(once.byPath('/v5/market/open-interest')).toHaveLength(2);

      const always = fakeBybit({ oiStart: NOW - 10 * BAR_MS, oiEnd: NOW, intercept: () => bad });
      global.fetch = always.fetchMock as unknown as typeof fetch;
      await expect(adapter().fetchObservations(source, 'openInterest', NOW - 10 * BAR_MS, NOW)).rejects.toThrow(
        /retCode 10006/,
      );
      expect(always.calls).toHaveLength(2);
    });

    it('paces history requests at BYBIT_REQUEST_PACING_MS (2 req/s) by default', async () => {
      expect(BYBIT_REQUEST_PACING_MS).toBe(500);
      const venue = fakeBybit({ oiStart: NOW - 300 * BAR_MS, oiEnd: NOW });
      const at: number[] = [];
      global.fetch = jest.fn(async (url: URL) => {
        at.push(performance.now());
        return venue.fetchMock(url);
      }) as unknown as typeof fetch;

      await new BybitMetricsAdapter('https://api.bybit.example').fetchObservations(
        source,
        'openInterest',
        NOW - 300 * BAR_MS,
        NOW,
      );

      expect(at).toHaveLength(3); // 2 OI pages + 1 mark-kline page
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(BYBIT_REQUEST_PACING_MS - 5);
    });
  });

  it('declares its own history depth from BYBIT_OI_HISTORY_DAYS (default 1095 days)', () => {
    expect(new BybitMetricsAdapter('x').historyDepthMs).toBe(1095 * 24 * 60 * 60_000);
    expect(new BybitMetricsAdapter('x', { historyDays: 10 }).historyDepthMs).toBe(10 * 24 * 60 * 60_000);
  });

  it('is registered for venue "bybit" in live mode, its drift guard wired to metric_sidedness_drift_total{source}', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const env: Record<string, unknown> = {
      MARKET_DATA_MODE: 'live',
      BINANCE_REST_BASE_URL: 'https://fapi.example',
      BYBIT_REST_BASE_URL: 'https://api.bybit.example',
      BYBIT_OI_HISTORY_DAYS: 400,
    };
    const metrics = new MetricsService();
    const adapters = buildMetricAdapters({ env: { get: (k: string) => env[k] } } as never, metrics);
    const bybit = adapters.get('bybit')!;
    expect(bybit).toBeInstanceOf(BybitMetricsAdapter);
    expect(bybit.historyDepthMs).toBe(400 * 24 * 60 * 60_000);

    const venue = fakeBybit({ oiStart: NOW - BAR_MS, oiEnd: NOW, ratio: () => 1 });
    global.fetch = venue.fetchMock as unknown as typeof fetch;
    await bybit.fetchObservations(source as never, 'openInterest', NOW - BAR_MS, NOW);

    const counter = await metrics.metricSidednessDriftTotal.get();
    expect(counter.values).toEqual([expect.objectContaining({ labels: { source: 'bybit:BTCUSDT' }, value: 2 })]);
  });
});

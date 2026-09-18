import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Instrument, MetricObservation } from '@trade-automation/contracts';
import { MetricIngestionService } from '../../../src/market-data/metrics/metric-ingestion.service';
import { MetricCache } from '../../../src/market-data/metrics/metric-cache.service';
import { BybitMetricsAdapter } from '../../../src/market-data/metrics/bybit/bybit-metrics.adapter';
import * as metricAdaptersProvider from '../../../src/market-data/metric-adapters.provider';

jest.mock('../../../src/market-data/metric-adapters.provider');

/*
 * architecture/aggregate-oi.md §5 "Deep crawl — never on the boot path" (SE-AG1): Phase 1
 * fetches only the tail; Phase 2 walks back from the OLDEST STORED row to the adapter's own
 * `historyDepthMs`, persisting each chunk, so an interrupted crawl resumes on the next boot.
 */

// A Bybit leg as a chart instrument, until SE-AG3's metricPairs() adds aggregate members.
const instrument: Instrument = {
  id: 'bybit:BTCUSDT',
  venue: 'bybit',
  symbol: 'BTCUSDT',
  assetClass: 'crypto-perp',
  displayName: 'BTC/USDT Perp (Bybit)',
  pricePrecision: 2,
  quoteCurrency: 'USDT',
  sessionTimezone: 'UTC',
};

const BAR_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const NOW = 1_800_000_000_000;

function fakeConfig() {
  return {
    instruments: [instrument],
    layouts: [
      {
        id: 'crypto',
        name: 'Crypto',
        grid: { columns: 1, rows: 1 },
        panels: [{ id: 'oi', kind: 'metric', instrument: instrument.id, metric: 'openInterest', signals: false }],
      },
    ],
    env: { get: (key: string) => (key === 'METRIC_POLL_INTERVAL_MS' ? 60_000 : undefined) },
  } as never;
}

const appMetrics = () =>
  ({
    metricObservationsTotal: { inc: jest.fn() },
    metricPollErrorsTotal: { inc: jest.fn() },
    metricNotionalMissingTotal: { inc: jest.fn() },
  }) as never;

/** In-memory MetricStore keyed by time, for one series. */
function memoryStore(initial: MetricObservation[] = []) {
  const rows = new Map(initial.map((o) => [o.time, o]));
  const sorted = () => [...rows.values()].sort((a, b) => a.time - b.time);
  return {
    rows,
    upsert: jest.fn(async (os: MetricObservation[]) => void os.forEach((o) => rows.set(o.time, o))),
    query: jest.fn(async (_i: string, _m: string, from: number, to: number) =>
      sorted().filter((o) => o.time >= from && o.time <= to),
    ),
    latestTime: jest.fn(async () => (rows.size ? sorted()[rows.size - 1].time : null)),
    earliestTime: jest.fn(async () => (rows.size ? sorted()[0].time : null)),
  };
}

const obs = (time: number): MetricObservation => ({
  metric: 'openInterest',
  instrument: instrument.id,
  time,
  value: 1,
  unit: 'base',
});

function series(from: number, to: number): MetricObservation[] {
  const out: MetricObservation[] = [];
  for (let t = Math.ceil(from / BAR_MS) * BAR_MS; t <= to; t += BAR_MS) out.push(obs(t));
  return out;
}

function makeService(
  adapter: object,
  store: ReturnType<typeof memoryStore>,
  cache = new MetricCache(),
  events = new EventEmitter2(),
) {
  (metricAdaptersProvider.buildMetricAdapters as jest.Mock).mockReturnValue(new Map([['bybit', adapter]]));
  const service = new MetricIngestionService(
    fakeConfig(),
    cache,
    events,
    { add: jest.fn(async () => undefined) } as never,
    { tick$: { subscribe: jest.fn(() => ({ unsubscribe: () => undefined })) } } as never,
    appMetrics(),
    store as never,
  );
  return { service, cache };
}

/** Phase 1 then Phase 2, as main.ts runs them (the store's latest row is `now`: no tail). */
async function boot(service: MetricIngestionService) {
  await service.onApplicationBootstrap();
  await service.deepenHistoryAsync();
}

describe('MetricIngestionService deep crawl (aggregate-oi.md §5)', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const fakeDeepAdapter = (depthDays: number) => ({
    venue: 'bybit' as const,
    supports: ['openInterest'] as const,
    historyDepthMs: depthDays * DAY_MS,
    fetchObservations: jest.fn(async (_i: Instrument, _m: string, from: number, to: number) => series(from, to)),
    fetchLatest: jest.fn(async () => obs(NOW)),
  });

  it('Phase 1 (warm-up) fetches only the recent window — never the multi-year crawl', async () => {
    const adapter = fakeDeepAdapter(1095);
    const { service } = makeService(adapter, memoryStore());

    await service.onApplicationBootstrap();

    expect(adapter.fetchObservations).toHaveBeenCalledTimes(1);
    const [, , from] = adapter.fetchObservations.mock.calls[0];
    expect(from).toBe(NOW - DAY_MS);
  });

  describe('Phase 1 tail capped at 24 h, the rest in Phase 2 (generic, not Bybit-specific)', () => {
    function observe(events: EventEmitter2) {
      const seen: MetricObservation[] = [];
      events.on('market-data.metric.observed', (e: { observation: MetricObservation }) => seen.push(e.observation));
      return seen;
    }
    const shallowAdapter = () => ({ ...fakeDeepAdapter(0), venue: 'bybit' as const, historyDepthMs: undefined });

    it('fresh store: Phase 1 requests only the last 24 h; Phase 2 fills back to 30 days; deep rows are not emitted', async () => {
      const adapter = shallowAdapter();
      const events = new EventEmitter2();
      const seen = observe(events);
      const { service, cache } = makeService(adapter, memoryStore(), new MetricCache(), events);

      await service.onApplicationBootstrap();
      expect(adapter.fetchObservations.mock.calls.map(([, , f, t]) => [f, t])).toEqual([[NOW - DAY_MS, NOW]]);
      const emittedAtBoot = seen.length;
      expect(emittedAtBoot).toBe(series(NOW - DAY_MS, NOW).length);

      await service.deepenHistoryAsync();
      expect(adapter.fetchObservations.mock.calls[1].slice(2)).toEqual([NOW - 30 * DAY_MS, NOW - DAY_MS - 1]);
      expect(cache.window(instrument.id, 'openInterest')[0].time).toBe(NOW - 30 * DAY_MS);
      expect(seen).toHaveLength(emittedAtBoot);
    });

    it('stored rows older than 24 h: Phase 1 tail is still 24 h; Phase 2 fills the gap back to latestStored, not emitted', async () => {
      const adapter = shallowAdapter();
      const latest = NOW - 3 * DAY_MS;
      const store = memoryStore(series(NOW - 30 * DAY_MS, latest));
      const events = new EventEmitter2();
      const seen = observe(events);
      const { service, cache } = makeService(adapter, store, new MetricCache(), events);

      await service.onApplicationBootstrap();
      expect(adapter.fetchObservations.mock.calls.map(([, , f, t]) => [f, t])).toEqual([[NOW - DAY_MS, NOW]]);
      const emittedAtBoot = seen.length;

      await service.deepenHistoryAsync();
      expect(adapter.fetchObservations.mock.calls[1].slice(2)).toEqual([latest + 1, NOW - DAY_MS - 1]);
      const window = cache.window(instrument.id, 'openInterest');
      for (let i = 1; i < window.length; i++) expect(window[i].time - window[i - 1].time).toBe(BAR_MS);
      expect(seen).toHaveLength(emittedAtBoot);
    });

    it('stored rows within 24 h: Phase 1 keeps the tail since latestStored, Phase 2 has no gap to fill', async () => {
      const adapter = shallowAdapter();
      const latest = NOW - 2 * 60 * 60_000;
      const { service } = makeService(adapter, memoryStore(series(NOW - 30 * DAY_MS, latest)));

      await boot(service);
      expect(adapter.fetchObservations.mock.calls.map(([, , f, t]) => [f, t])).toEqual([[latest + 1, NOW]]);
    });
  });

  it('Phase 2 resumes from the OLDEST STORED row, walks back to now − historyDepthMs, stores each chunk, keeps it out of the cache', async () => {
    const adapter = fakeDeepAdapter(60);
    // A previous boot's crawl reached 45 days back before being interrupted.
    const resumeFrom = NOW - 45 * DAY_MS;
    const store = memoryStore([...series(resumeFrom, resumeFrom + DAY_MS), ...series(NOW - 30 * DAY_MS, NOW)]);
    const cache = new MetricCache();
    for (const o of series(NOW - 30 * DAY_MS, NOW)) cache.upsert(o);
    const { service } = makeService(adapter, store, cache);

    await boot(service);

    const windows = adapter.fetchObservations.mock.calls.map(([, , from, to]) => [from, to]);
    // First deep call ends just before the oldest stored row — not at the cache edge, not at now.
    expect(windows[0][1]).toBe(resumeFrom - 1);
    // Contiguous chunks, walking backward, ending at the depth target.
    for (let i = 1; i < windows.length; i++) expect(windows[i][1]).toBe(windows[i - 1][0] - 1);
    expect(windows[windows.length - 1][0]).toBe(NOW - 60 * DAY_MS);
    expect(await store.earliestTime()).toBe(NOW - 60 * DAY_MS);
    // One awaited store write per chunk (that is what makes the crawl resumable).
    expect(store.upsert).toHaveBeenCalledTimes(windows.length);
    // Nothing older than the 30-day cache window entered the cache.
    expect(cache.window(instrument.id, 'openInterest')[0].time).toBeGreaterThanOrEqual(NOW - 30 * DAY_MS);
    expect(service.status()[0].backfillStatus).toBe('complete');
  });

  it('an adapter without historyDepthMs (Binance) is never crawled beyond the cache window', async () => {
    const adapter = { ...fakeDeepAdapter(0), historyDepthMs: undefined };
    const store = memoryStore(series(NOW - 30 * DAY_MS, NOW));
    const cache = new MetricCache();
    for (const o of series(NOW - 30 * DAY_MS, NOW)) cache.upsert(o);
    const { service } = makeService(adapter, store, cache);

    await boot(service);

    expect(adapter.fetchObservations).not.toHaveBeenCalled();
    expect(store.earliestTime).not.toHaveBeenCalled();
  });

  it('stops the pass on HTTP 403 (real adapter), keeps what it stored, and the next boot resumes from there', async () => {
    // A venue with 3 years of history; the 403 hits after a couple of chunks.
    let calls = 0;
    let banAfter = 30;
    const realFetch = global.fetch;
    global.fetch = jest.fn(async (url: URL) => {
      calls++;
      if (calls > banAfter) return { ok: false, status: 403, statusText: 'Forbidden', json: async () => ({}) };
      const p = url.searchParams;
      const limit = Number(p.get('limit'));
      const kline = url.pathname.endsWith('mark-price-kline');
      const lo = Math.ceil(Number(p.get(kline ? 'start' : 'startTime')) / BAR_MS) * BAR_MS;
      const hi = Math.min(NOW, Number(p.get(kline ? 'end' : 'endTime')));
      const stamps: number[] = [];
      for (let t = lo; t <= hi; t += BAR_MS) stamps.push(t);
      const page = stamps.slice(-limit).reverse();
      const list = kline
        ? page.map((t) => [String(t), '1', '1', '1', '50000'])
        : page.map((t) => ({ openInterest: '200', singleOpenInterest: '100', timestamp: String(t) }));
      return { ok: true, status: 200, json: async () => ({ retCode: 0, retMsg: 'OK', result: { list }, time: NOW }) };
    }) as unknown as typeof fetch;

    try {
      const adapter = new BybitMetricsAdapter('https://api.bybit.example', { pacingMs: 0, historyDays: 1095 });
      const store = memoryStore(series(NOW - 30 * DAY_MS, NOW));
      const cache = new MetricCache();
      for (const o of series(NOW - 30 * DAY_MS, NOW)) cache.upsert(o);
      const first = makeService(adapter, store, cache).service;

      await boot(first);

      const callsAtBan = calls;
      expect(callsAtBan).toBe(banAfter + 1); // the 403 ended the pass: not one request after it
      const reached = (await store.earliestTime())!;
      expect(reached).toBeLessThan(NOW - 30 * DAY_MS); // chunks before the ban were persisted
      expect(reached).toBeGreaterThan(NOW - 1095 * DAY_MS);
      expect(first.status()[0].backfillStatus).toBe('complete');

      // Next boot, ban lifted: the first deep request ends right below the oldest stored row.
      banAfter = Infinity;
      const oiEndTimes: number[] = [];
      const inner = global.fetch as jest.Mock;
      global.fetch = jest.fn(async (url: URL) => {
        if (url.pathname.endsWith('open-interest')) oiEndTimes.push(Number(url.searchParams.get('endTime')));
        return inner(url);
      }) as unknown as typeof fetch;
      const second = makeService(adapter, store, cache).service;
      await boot(second);

      expect(oiEndTimes[0]).toBe(reached - 1);
      expect(await store.earliestTime()).toBe(Math.ceil((NOW - 1095 * DAY_MS) / BAR_MS) * BAR_MS);
    } finally {
      global.fetch = realFetch;
    }
  });
});

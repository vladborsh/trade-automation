import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Instrument, MetricObservation } from '@trade-automation/contracts';
import { MetricIngestionService } from '../../../src/market-data/metrics/metric-ingestion.service';
import { MetricCache } from '../../../src/market-data/metrics/metric-cache.service';
import * as metricAdaptersProvider from '../../../src/market-data/metric-adapters.provider';

jest.mock('../../../src/market-data/metric-adapters.provider');

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

function fakeConfig(overrides: { pollIntervalMs?: number } = {}) {
  return {
    instruments: [instrument],
    layouts: [
      {
        id: 'crypto',
        name: 'Crypto',
        grid: { columns: 1, rows: 1 },
        panels: [
          { id: 'oi', kind: 'metric', instrument: instrument.id, metric: 'openInterest', signals: false },
        ],
      },
    ],
    env: {
      get: (key: string) => (key === 'METRIC_POLL_INTERVAL_MS' ? (overrides.pollIntervalMs ?? 60_000) : undefined),
    },
  } as never;
}

/** The bar-clock subscriber fires `maybePoll` without awaiting it; let the poll settle. */
const flushPoll = () => new Promise((resolve) => setImmediate(resolve));

function fakeAppMetrics() {
  return {
    metricObservationsTotal: { inc: jest.fn() },
    metricPollErrorsTotal: { inc: jest.fn() },
    metricNotionalMissingTotal: { inc: jest.fn() },
  } as never;
}

/**
 * architecture/chart-layouts.md §4.4, §9 — "ingestion boot order tested against fixtures
 * (storage-then-backfill-then-poll ordering, not just that each step works in isolation)",
 * mirroring IngestionService's boot-order contract for candles.
 */
describe('MetricIngestionService boot order', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0); // no poll jitter delay in tests
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads storage, then backfills the tail from the adapter, then starts polling — in that order', async () => {
    const calls: string[] = [];

    const store = {
      latestTime: jest.fn(async () => {
        calls.push('store.latestTime');
        return null;
      }),
      query: jest.fn(async () => {
        calls.push('store.query');
        return [];
      }),
      upsert: jest.fn(async () => undefined),
    };

    const backfilled: MetricObservation = { metric: 'openInterest', instrument: instrument.id, time: 1000, value: 1, unit: 'base' };
    const adapter = {
      venue: 'binance' as const,
      supports: ['openInterest'] as const,
      fetchObservations: jest.fn(async () => {
        calls.push('adapter.fetchObservations');
        return [backfilled];
      }),
      fetchLatest: jest.fn(async () => {
        calls.push('adapter.fetchLatest');
        return { metric: 'openInterest', instrument: instrument.id, time: 2000, value: 2, unit: 'base' } as MetricObservation;
      }),
    };
    (metricAdaptersProvider.buildMetricAdapters as jest.Mock).mockReturnValue(new Map([['binance', adapter]]));

    const cache = new MetricCache();
    const events = new EventEmitter2();
    const writeBuffer = {
      add: jest.fn(async (o: MetricObservation) => {
        calls.push(`writeBuffer.add:${o.time}`);
      }),
    } as never;
    const barClock = {
      tick$: {
        subscribe: (_cb: () => void) => {
          calls.push('barClock.subscribe');
          return { unsubscribe: () => undefined };
        },
      },
    } as never;

    const service = new MetricIngestionService(
      fakeConfig(),
      cache,
      events,
      writeBuffer,
      barClock,
      fakeAppMetrics(),
      store as never,
    );

    await service.onApplicationBootstrap();

    expect(calls).toEqual([
      'store.latestTime',
      'store.query',
      'adapter.fetchObservations',
      'writeBuffer.add:1000',
      'barClock.subscribe',
    ]);
    // Polling only happens on a bar-clock tick, never eagerly at boot.
    expect(adapter.fetchLatest).not.toHaveBeenCalled();
    expect(cache.latest(instrument.id, 'openInterest')).toEqual(backfilled);
  });

  it('polls the adapter on a bar-clock tick, gated by METRIC_POLL_INTERVAL_MS, and emits MetricObserved', async () => {
    const store = {
      latestTime: jest.fn(async () => null),
      query: jest.fn(async () => []),
      upsert: jest.fn(async () => undefined),
    };
    const latest: MetricObservation = { metric: 'openInterest', instrument: instrument.id, time: 60_000, value: 5, unit: 'base' };
    const adapter = {
      venue: 'binance' as const,
      supports: ['openInterest'] as const,
      fetchObservations: jest.fn(async () => []),
      fetchLatest: jest.fn(async () => latest),
    };
    (metricAdaptersProvider.buildMetricAdapters as jest.Mock).mockReturnValue(new Map([['binance', adapter]]));

    let tickCb: (() => void) | undefined;
    const barClock = {
      tick$: { subscribe: (cb: () => void) => ((tickCb = cb), { unsubscribe: () => undefined }) },
    } as never;
    const events = new EventEmitter2();
    const observed: MetricObservation[] = [];
    events.on('market-data.metric.observed', (e: { observation: MetricObservation }) => observed.push(e.observation));
    const writeBuffer = { add: jest.fn(async () => undefined) } as never;

    const service = new MetricIngestionService(
      fakeConfig({ pollIntervalMs: 60_000 }),
      new MetricCache(),
      events,
      writeBuffer,
      barClock,
      fakeAppMetrics(),
      store as never,
    );
    await service.onApplicationBootstrap();
    expect(tickCb).toBeDefined();

    await tickCb!();
    await flushPoll();
    expect(adapter.fetchLatest).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([latest]);

    // A second tick immediately after must be skipped — interval not yet elapsed.
    await tickCb!();
    expect(adapter.fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('marks a metric pair down (no fetch attempted) when its venue has no MetricAdapter', async () => {
    (metricAdaptersProvider.buildMetricAdapters as jest.Mock).mockReturnValue(new Map());
    const store = { latestTime: jest.fn(), query: jest.fn(), upsert: jest.fn() };
    const barClock = { tick$: { subscribe: jest.fn(() => ({ unsubscribe: () => undefined })) } } as never;

    const service = new MetricIngestionService(
      fakeConfig(),
      new MetricCache(),
      new EventEmitter2(),
      { add: jest.fn() } as never,
      barClock,
      fakeAppMetrics(),
      store as never,
    );

    await service.onApplicationBootstrap();

    expect(store.latestTime).not.toHaveBeenCalled();
    expect(service.status()).toEqual([
      { instrument: instrument.id, metric: 'openInterest', lastObservationAge: null, backfillStatus: 'complete' },
    ]);
  });

  /**
   * architecture/panel-sync-and-oi-depth-diagnosis.md, Bug 2, defect 2 — restart with a store
   * shallower than the full lookback must not stay shallow forever: Phase 1 (`warmUp`) only
   * ever extends forward from `latestStored`, so this asserts the new Phase 2
   * `deepenHistoryAsync()` (fired from `main.ts` after `listen()`, mirroring the candle path)
   * actually extends the cache backward to the full 30-day window.
   */
  it('deepens a shallow store backward to the full lookback after Phase 2 runs, without re-emitting MetricObserved', async () => {
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const PERIOD_MS = 5 * 60_000;
    const SHALLOW_DEPTH_MS = 2 * 24 * 60 * 60_000; // "restart with a shallow store": only 2 days on hand
    const FULL_DEPTH_MS = 30 * 24 * 60 * 60_000;

    const shallowStart = now - SHALLOW_DEPTH_MS;
    const shallowObservations: MetricObservation[] = [];
    for (let t = shallowStart; t <= now; t += PERIOD_MS) {
      shallowObservations.push({ metric: 'openInterest', instrument: instrument.id, time: t, value: 1, unit: 'base' });
    }

    const store = {
      latestTime: jest.fn(async () => now),
      query: jest.fn(async () => shallowObservations),
      upsert: jest.fn(async () => undefined),
    };

    // Fake adapter models the venue: fetchObservations(from, to) returns the full ascending,
    // gapless range asked for (the real adapter's own pagination is covered separately in
    // binance-metrics.adapter.spec.ts) — this spec is about the ingestion-side deepen wiring.
    const adapter = {
      venue: 'binance' as const,
      supports: ['openInterest'] as const,
      fetchObservations: jest.fn(async (_instrument: Instrument, _metric: string, from: number, to: number) => {
        const rows: MetricObservation[] = [];
        for (let t = from; t <= to; t += PERIOD_MS) {
          rows.push({ metric: 'openInterest', instrument: instrument.id, time: t, value: 2, unit: 'base' });
        }
        return rows;
      }),
      fetchLatest: jest.fn(async () => ({ metric: 'openInterest', instrument: instrument.id, time: now, value: 1, unit: 'base' })),
    };
    (metricAdaptersProvider.buildMetricAdapters as jest.Mock).mockReturnValue(new Map([['binance', adapter]]));

    const cache = new MetricCache();
    const events = new EventEmitter2();
    const observed: MetricObservation[] = [];
    events.on('market-data.metric.observed', (e: { observation: MetricObservation }) => observed.push(e.observation));
    const writeBuffer = { add: jest.fn(async () => undefined) } as never;
    const barClock = { tick$: { subscribe: jest.fn(() => ({ unsubscribe: () => undefined })) } } as never;

    const service = new MetricIngestionService(
      fakeConfig(),
      cache,
      events,
      writeBuffer,
      barClock,
      fakeAppMetrics(),
      store as never,
    );

    await service.onApplicationBootstrap();

    // Phase 1 alone leaves the store's own shallow depth — no adapter backfill call needed
    // (warm-up's tail is already covered by `now`).
    expect(cache.window(instrument.id, 'openInterest')[0]?.time).toBe(shallowStart);
    expect(
      service.status().find((s) => s.metric === 'openInterest')?.backfillStatus,
    ).toBe('complete'); // no deepen has run yet — default is 'complete', not 'deepening'

    const deepenPromise = service.deepenHistoryAsync();
    expect(
      service.status().find((s) => s.metric === 'openInterest')?.backfillStatus,
    ).toBe('deepening');
    await deepenPromise;

    const window = cache.window(instrument.id, 'openInterest');
    expect(window[0]?.time).toBeLessThanOrEqual(now - FULL_DEPTH_MS + PERIOD_MS);
    expect(window[window.length - 1]?.time).toBe(now); // the fresher, Phase-1-loaded tail is untouched

    expect(service.status().find((s) => s.metric === 'openInterest')?.backfillStatus).toBe('complete');

    // Deep rows must never hit the live event bus (would be thousands of stale MetricObserved
    // events to every WS client on every boot) — only the original Phase-1 tail observation.
    expect(observed).toHaveLength(0);
  });
});

/** architecture/chart-layouts.md §11.1 "The live tip" + "Legacy tip rows" — mark price. */
describe('MetricIngestionService derived tip notional', () => {
  const MIN = 60_000;
  const T = 1_800_000_000_000 - (1_800_000_000_000 % MIN);

  function snapshot(time: number, value: number): MetricObservation {
    return { metric: 'openInterest', instrument: instrument.id, time, value, unit: 'base' };
  }

  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function bootPolling(opts: {
    latest: () => MetricObservation;
    tipPrice: () => Promise<{ time: number; price: number }>;
    appMetrics?: ReturnType<typeof fakeAppMetrics>;
  }) {
    let now = T;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const adapter = {
      venue: 'binance' as const,
      supports: ['openInterest'] as const,
      fetchObservations: jest.fn(async () => []),
      fetchLatest: jest.fn(async () => opts.latest()),
      fetchTipPrice: jest.fn(opts.tipPrice),
    };
    (metricAdaptersProvider.buildMetricAdapters as jest.Mock).mockReturnValue(new Map([['binance', adapter]]));
    let tickCb: (() => Promise<void>) | undefined;
    const barClock = {
      tick$: { subscribe: (cb: () => Promise<void>) => ((tickCb = cb), { unsubscribe: () => undefined }) },
    } as never;
    const events = new EventEmitter2();
    const observed: MetricObservation[] = [];
    events.on('market-data.metric.observed', (e: { observation: MetricObservation }) => observed.push(e.observation));
    const written: MetricObservation[] = [];
    const cache = new MetricCache();
    const service = new MetricIngestionService(
      fakeConfig(),
      cache,
      events,
      { add: jest.fn(async (o: MetricObservation) => void written.push(o)) } as never,
      barClock,
      opts.appMetrics ?? fakeAppMetrics(),
      { latestTime: jest.fn(async () => T), query: jest.fn(async () => []), upsert: jest.fn() } as never,
    );
    await service.onApplicationBootstrap();
    const tick = async () => {
      now += MIN;
      await tickCb!();
      await flushPoll();
    };
    return { tick, observed, written, cache, adapter };
  }

  it('mark price accepted: notional = value × markPrice, basis "derived", on the stored and emitted observation', async () => {
    const { tick, observed, written, adapter } = await bootPolling({
      latest: () => snapshot(T + MIN + 2_000, 100),
      tipPrice: async () => ({ time: T + MIN + 2_100, price: 50_100 }),
    });

    await tick();

    const expected = { ...snapshot(T + MIN + 2_000, 100), notional: 5_010_000, notionalBasis: 'derived' };
    expect(adapter.fetchTipPrice).toHaveBeenCalledTimes(1); // same poll, one request
    expect(observed).toEqual([expected]);
    expect(written).toEqual([expected]);
  });

  it('mark price stale (> 120 s from the snapshot): no notional, counted, one warn per streak', async () => {
    const appMetrics = fakeAppMetrics() as unknown as { metricNotionalMissingTotal: { inc: jest.Mock } };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let snapTime = T + MIN;
    let priceTime = T - 2 * MIN; // 3 min before the snapshot
    const { tick, observed } = await bootPolling({
      latest: () => snapshot(snapTime, 100),
      tipPrice: async () => ({ time: priceTime, price: 50_000 }),
      appMetrics: appMetrics as never,
    });

    await tick();
    snapTime += MIN;
    await tick(); // still stale
    expect(observed.map((o) => o.notional)).toEqual([undefined, undefined]);
    expect(observed.every((o) => o.notionalBasis === undefined)).toBe(true);
    expect(appMetrics.metricNotionalMissingTotal.inc).toHaveBeenCalledTimes(2);
    expect(appMetrics.metricNotionalMissingTotal.inc).toHaveBeenCalledWith({
      instrument: instrument.id,
      metric: 'openInterest',
    });
    expect(warn).toHaveBeenCalledTimes(1);

    // Fresh price → notional again; a later outage is a new streak with a new warn.
    snapTime += MIN;
    priceTime = snapTime;
    await tick();
    expect(observed[2].notional).toBe(5_000_000);
    snapTime += MIN;
    priceTime = snapTime - 10 * MIN;
    await tick();
    expect(observed[3].notional).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('premiumIndex failure: OI snapshot still stored and emitted, without notional, and counted', async () => {
    const appMetrics = fakeAppMetrics() as unknown as {
      metricNotionalMissingTotal: { inc: jest.Mock };
      metricPollErrorsTotal: { inc: jest.Mock };
    };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { tick, observed, written, cache } = await bootPolling({
      latest: () => snapshot(T + MIN + 2_000, 100),
      tipPrice: async () => {
        throw new Error('Binance premiumIndex request failed: 503 Service Unavailable');
      },
      appMetrics: appMetrics as never,
    });

    await tick();

    expect(observed).toEqual([snapshot(T + MIN + 2_000, 100)]);
    expect(written).toEqual([snapshot(T + MIN + 2_000, 100)]);
    expect(cache.latest(instrument.id, 'openInterest')).toEqual(snapshot(T + MIN + 2_000, 100));
    expect(appMetrics.metricNotionalMissingTotal.inc).toHaveBeenCalledTimes(1);
    expect(appMetrics.metricPollErrorsTotal.inc).not.toHaveBeenCalled();
  });

  it('repairs stored snapshots without notional from mark-price history once per boot; idempotent; no events', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(T + 60 * MIN);
    const history: MetricObservation = { ...snapshot(T - 300 * MIN, 90), notional: 4_500_000, notionalBasis: 'venue' };
    const oldTip = snapshot(T - 200 * MIN + 1_500, 95);
    const recentTip = snapshot(T + 1_500, 100);
    const orphanTip = snapshot(T + 30 * MIN + 1_500, 101); // no mark bar within 120 s
    const stored = [history, oldTip, recentTip, orphanTip];

    const fetchTipPriceHistory = jest.fn(async () => [
      { time: T - 200 * MIN, price: 49_000 },
      { time: T, price: 50_000 },
      { time: T + 20 * MIN, price: 50_500 },
    ]);
    const adapter = {
      venue: 'binance' as const,
      supports: ['openInterest'] as const,
      fetchObservations: jest.fn(async () => []),
      fetchLatest: jest.fn(),
      fetchTipPrice: jest.fn(),
      fetchTipPriceHistory,
    };
    (metricAdaptersProvider.buildMetricAdapters as jest.Mock).mockReturnValue(new Map([['binance', adapter]]));
    const events = new EventEmitter2();
    const emitted = jest.fn();
    events.on('market-data.metric.observed', emitted);
    const written: MetricObservation[] = [];
    const cache = new MetricCache();
    const service = new MetricIngestionService(
      fakeConfig(),
      cache,
      events,
      { add: jest.fn(async (o: MetricObservation) => void written.push(o)) } as never,
      { tick$: { subscribe: jest.fn(() => ({ unsubscribe: () => undefined })) } } as never,
      fakeAppMetrics(),
      { latestTime: jest.fn(async () => T + 60 * MIN), query: jest.fn(async () => stored), upsert: jest.fn() } as never,
    );
    await service.onApplicationBootstrap();
    await service.deepenHistoryAsync();

    // Only rows lacking notional are asked about — never the venue history row.
    expect(fetchTipPriceHistory).toHaveBeenCalledWith(instrument, [oldTip.time, recentTip.time, orphanTip.time]);
    const repairedOld = { ...oldTip, notional: 95 * 49_000, notionalBasis: 'derived' };
    const repairedRecent = { ...recentTip, notional: 100 * 50_000, notionalBasis: 'derived' };
    expect(written).toEqual([repairedOld, repairedRecent]);
    expect(cache.window(instrument.id, 'openInterest')).toEqual([history, repairedOld, repairedRecent, orphanTip]);
    expect(emitted).not.toHaveBeenCalled();

    // A second pass only re-asks about the orphan, and leaves it as is.
    written.length = 0;
    await service.deepenHistoryAsync();
    expect(fetchTipPriceHistory).toHaveBeenLastCalledWith(instrument, [orphanTip.time]);
    expect(written).toEqual([]);
    expect(cache.window(instrument.id, 'openInterest')[3]).toEqual(orphanTip);
  });
});

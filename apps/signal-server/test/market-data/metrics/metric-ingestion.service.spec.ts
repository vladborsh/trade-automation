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

function fakeAppMetrics() {
  return {
    metricObservationsTotal: { inc: jest.fn() },
    metricPollErrorsTotal: { inc: jest.fn() },
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

    const backfilled: MetricObservation = { metric: 'openInterest', instrument: instrument.id, time: 1000, value: 1 };
    const adapter = {
      venue: 'binance' as const,
      supports: ['openInterest'] as const,
      fetchObservations: jest.fn(async () => {
        calls.push('adapter.fetchObservations');
        return [backfilled];
      }),
      fetchLatest: jest.fn(async () => {
        calls.push('adapter.fetchLatest');
        return { metric: 'openInterest', instrument: instrument.id, time: 2000, value: 2 } as MetricObservation;
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
    const latest: MetricObservation = { metric: 'openInterest', instrument: instrument.id, time: 60_000, value: 5 };
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
      { instrument: instrument.id, metric: 'openInterest', lastObservationAge: null },
    ]);
  });
});

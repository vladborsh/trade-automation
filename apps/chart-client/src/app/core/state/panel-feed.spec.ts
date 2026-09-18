import { vi } from 'vitest';
import { PanelFeed } from './panel-feed';
import { LiveSocket } from '../api/live.socket';
import type { RestClient } from '../api/rest.client';
import type { SocketFactory, SocketLike } from '../api/socket-factory';
import type { Candle, IndicatorPoint, Panel, Signal } from '@trade-automation/contracts';

/** Fake socket, same pattern as live.socket.spec.ts. */
class FakeSocket implements SocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
}

function candle(openTime: number): Candle {
  return {
    instrument: 'binance:BTCUSDT',
    timeframe: '1m',
    openTime,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    closed: true,
    source: 'venue-stream',
  };
}

function fakeRest(overrides: Partial<Record<keyof RestClient, unknown>> = {}): RestClient {
  return {
    getCandles: vi.fn().mockResolvedValue([candle(1000)]),
    getSignals: vi.fn().mockResolvedValue([] as Signal[]),
    getIndicators: vi.fn().mockResolvedValue([] as IndicatorPoint[]),
    getMetrics: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as RestClient;
}

function candlesPanel(signals: boolean): Panel {
  return { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals };
}

function metricPanel(): Panel {
  return { id: 'btc-oi', kind: 'metric', instrument: 'binance:BTCUSDT', metric: 'openInterest', signals: false };
}

describe('PanelFeed', () => {
  let sockets: FakeSocket[];
  let factory: SocketFactory;
  let live: LiveSocket;

  beforeEach(() => {
    sockets = [];
    factory = () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    };
    live = new LiveSocket();
    live.useSocketFactory(factory);
    live.connect('ws://fake/ws');
    sockets[0].simulateOpen();
  });

  it('a signals:false panel never fetches or subscribes signals/indicators (§6.5)', async () => {
    const rest = fakeRest();
    const feed = new PanelFeed(candlesPanel(false), '1m', { rest, socket: live });
    await feed.start();

    expect(rest.getSignals).not.toHaveBeenCalled();
    expect(rest.getIndicators).not.toHaveBeenCalled();
    const sent = sockets[0].sent.map((s) => JSON.parse(s));
    expect(sent.some((f) => f.topic === 'signals')).toBe(false);
  });

  it('a signals:true panel fetches signal+indicator history and subscribes both', async () => {
    const rest = fakeRest();
    const feed = new PanelFeed(candlesPanel(true), '1m', { rest, socket: live });
    await feed.start();

    // from/to are required by the real server's wire contract (no `.default()` on either
    // field) - PanelFeed always sends a concrete, bounded range for the initial history load
    // (a literal `from: 0` would trigger the server's on-demand fetch-and-persist all the way
    // back to epoch — see panel-feed.ts's `boundedFrom`).
    expect(rest.getSignals).toHaveBeenCalledWith('binance:BTCUSDT', expect.any(Number), expect.any(Number));
    expect(rest.getIndicators).toHaveBeenCalledWith('binance:BTCUSDT', expect.any(Number), expect.any(Number));
    const sent = sockets[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'subscribe', topic: 'signals', instrument: 'binance:BTCUSDT' });
    expect(sent).toContainEqual({ type: 'subscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
  });

  it('a metric panel fetches/subscribes metrics, never candles', async () => {
    const rest = fakeRest();
    const feed = new PanelFeed(metricPanel(), '1m', { rest, socket: live });
    await feed.start();

    expect(rest.getCandles).not.toHaveBeenCalled();
    expect(rest.getMetrics).toHaveBeenCalledWith(
      'binance:BTCUSDT',
      'openInterest',
      '1m',
      expect.any(Number),
      expect.any(Number),
      1500,
    );
    const sent = sockets[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({
      type: 'subscribe',
      topic: 'metrics',
      instrument: 'binance:BTCUSDT',
      metric: 'openInterest',
      timeframe: '1m',
    });
  });

  it('an aggregate panel pages from /metric-aggregates, keeps the definition, subscribes metricAggregates (aggregate-oi.md §5)', async () => {
    const definition = { id: 'btc-perp-oi', displayName: 'BTC perps', metric: 'openInterest', countingConvention: 'one-sided', members: [] };
    const point = (time: number) => ({ time, aggregate: 'btc-perp-oi', timeframe: '5m', coverage: ['bybit:BTCUSDT'] });
    const getMetricAggregatePoints = vi
      .fn()
      .mockResolvedValueOnce({ aggregate: definition, points: [point(600_000), point(900_000)] })
      .mockResolvedValueOnce({ aggregate: definition, points: [point(300_000)] })
      .mockResolvedValueOnce({ aggregate: definition, points: [point(900_000), point(1_200_000)] });
    const rest = fakeRest({ getMetricAggregatePoints });
    const feed = new PanelFeed({ ...metricPanel(), aggregate: 'btc-perp-oi' }, '5m', { rest, socket: live });
    await feed.start();

    expect(rest.getMetrics).not.toHaveBeenCalled();
    expect(getMetricAggregatePoints).toHaveBeenCalledWith('btc-perp-oi', '5m', expect.any(Number), expect.any(Number), 1500);
    expect(feed.aggregate()).toEqual(definition);
    const sent = sockets[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'subscribe', topic: 'metricAggregates', aggregate: 'btc-perp-oi', timeframe: '5m' });
    expect(sent.some((f) => f.topic === 'metrics')).toBe(false);

    // same pagination + heal path as the single-venue metric feed
    await feed.loadOlder();
    expect(getMetricAggregatePoints.mock.calls[1][3]).toBe(600_000);
    await feed.healAfterReconnect();
    expect(getMetricAggregatePoints.mock.calls[2][2]).toBe(900_000);
    expect(feed.points.points().map((p) => p.time)).toEqual([300_000, 600_000, 900_000, 1_200_000]);

    // a live frame for this aggregate/timeframe merges; another timeframe's does not
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'metricAggregate', point: point(1_500_000) }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'metricAggregate', point: { ...point(1_800_000), timeframe: '1m' } }) });
    expect(feed.points.lastTime()).toBe(1_500_000);

    feed.stop();
    expect(sockets[0].sent.map((s) => JSON.parse(s))).toContainEqual({
      type: 'unsubscribe',
      topic: 'metricAggregates',
      aggregate: 'btc-perp-oi',
      timeframe: '5m',
    });
  });

  it('stop() unsubscribes every topic start() subscribed', async () => {
    const rest = fakeRest();
    const feed = new PanelFeed(candlesPanel(true), '1m', { rest, socket: live });
    await feed.start();
    sockets[0].sent = [];

    feed.stop();

    const sent = sockets[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'unsubscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
    expect(sent).toContainEqual({ type: 'unsubscribe', topic: 'signals', instrument: 'binance:BTCUSDT' });
  });

  it('loadOlder prepends a page before the oldest known candle', async () => {
    const getCandles = vi.fn().mockResolvedValueOnce([candle(1000)]).mockResolvedValueOnce([candle(500)]);
    const rest = fakeRest({ getCandles });
    const feed = new PanelFeed(candlesPanel(false), '1m', { rest, socket: live });
    await feed.start();

    await feed.loadOlder();

    expect(feed.candles.firstOpenTime()).toBe(500);
  });

  it('concurrent loadOlder() calls collapse into a single in-flight fetch (no race)', async () => {
    let resolveFetch: (v: Candle[]) => void;
    const pending = new Promise<Candle[]>((resolve) => {
      resolveFetch = resolve;
    });
    const getCandles = vi.fn().mockResolvedValueOnce([candle(1000)]).mockReturnValueOnce(pending);
    const rest = fakeRest({ getCandles });
    const feed = new PanelFeed(candlesPanel(false), '1m', { rest, socket: live });
    await feed.start();

    // Simulates ChartComponent's subscribeVisibleLogicalRangeChange firing on every frame
    // while dragging near the start, before the first fetch has resolved.
    const first = feed.loadOlder();
    const second = feed.loadOlder();
    const third = feed.loadOlder();

    expect(getCandles).toHaveBeenCalledTimes(2); // the initial start() call, plus exactly one loadOlder fetch
    resolveFetch!([candle(500)]);
    await Promise.all([first, second, third]);

    expect(getCandles).toHaveBeenCalledTimes(2); // still one — the queued calls were no-ops, not queued retries
    expect(feed.candles.firstOpenTime()).toBe(500);
  });

  // Realistic epoch-scale timestamps, not small integers: `boundedFrom` sizes its window off
  // the real TIMEFRAME_MS constant, so a tiny `openTime` like 10_000 clamps straight to the
  // `from <= 0` floor on the very first hop, never exercising the actual hop-past-a-gap logic.
  const REALISTIC_NOW = 1_800_000_000_000;

  it('loadOlder hops past an empty page (a real gap) instead of giving up immediately', async () => {
    const getCandles = vi
      .fn()
      .mockResolvedValueOnce([candle(REALISTIC_NOW)]) // start()
      .mockResolvedValueOnce([]) // first hop: lands in a gap
      .mockResolvedValueOnce([candle(REALISTIC_NOW - 1_000_000)]); // second hop: finds real data
    const rest = fakeRest({ getCandles });
    const feed = new PanelFeed(candlesPanel(false), '1m', { rest, socket: live });
    await feed.start();

    await feed.loadOlder();

    expect(getCandles).toHaveBeenCalledTimes(3);
    expect(feed.candles.firstOpenTime()).toBe(REALISTIC_NOW - 1_000_000);
  });

  it('loadOlder gives up after exhausting its hop budget on all-empty pages, and stops retrying', async () => {
    const getCandles = vi.fn().mockResolvedValueOnce([candle(REALISTIC_NOW)]).mockResolvedValue([]);
    const rest = fakeRest({ getCandles });
    const feed = new PanelFeed(candlesPanel(false), '1m', { rest, socket: live });
    await feed.start();

    await feed.loadOlder();
    const callsAfterFirstGiveUp = getCandles.mock.calls.length;
    expect(callsAfterFirstGiveUp).toBeGreaterThan(1); // it actually hopped, not just tried once

    await feed.loadOlder(); // a later scroll-frame trigger, after giving up

    expect(getCandles).toHaveBeenCalledTimes(callsAfterFirstGiveUp); // no new calls — noMoreOlderHistory latched
  });
});

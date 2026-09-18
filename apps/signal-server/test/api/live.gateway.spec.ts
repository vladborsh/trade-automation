import { LiveGateway } from '../../src/api/ws/live.gateway';
import { CandleClosedEvent, CandleFormingEvent } from '../../src/market-data/market-data.events';
import { MetricCache } from '../../src/market-data/metrics/metric-cache.service';
import { MetricObservedEvent } from '../../src/market-data/metrics/metric.events';
import { MetricsController } from '../../src/api/rest/metrics.controller';
import { Candle, MetricObservation } from '@trade-automation/contracts';

class FakeSocket {
  readyState = 1;
  sent: unknown[] = [];
  private handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  on(event: string, cb: (...args: unknown[]) => void): void {
    (this.handlers[event] ??= []).push(cb);
  }

  emitMessage(payload: unknown): void {
    for (const cb of this.handlers['message'] ?? []) cb(JSON.stringify(payload));
  }

  emitClose(): void {
    for (const cb of this.handlers['close'] ?? []) cb();
  }
}

function fakeStatus() {
  return {
    get: () => ({ venueStatus: 'up', lastClosedCandleTime: 123 }),
  } as never;
}

function fakeConfig() {
  return { env: { get: () => undefined } } as never;
}

function fakeMetrics() {
  return {
    wsClients: { set: jest.fn() },
    wsFramesSent: { inc: jest.fn() },
  } as never;
}

function observation(instrument: MetricObservation['instrument'], time: number, value: number): MetricObservation {
  return { metric: 'openInterest', instrument, time, value, unit: 'base' };
}

function makeGateway(cache = new MetricCache()) {
  return Object.assign(new LiveGateway(fakeStatus(), fakeConfig(), fakeMetrics(), cache), { cache });
}

/** What MetricIngestionService does: upsert into MetricCache, then emit MetricObserved. */
function observe(gateway: ReturnType<typeof makeGateway>, o: MetricObservation): void {
  gateway.cache.upsert(o);
  gateway.onMetricObserved(new MetricObservedEvent(o));
}

function candle(instrument: Candle['instrument'], timeframe: Candle['timeframe'], closed: boolean): Candle {
  return {
    instrument,
    timeframe,
    openTime: 0,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 0,
    closed,
    source: 'venue-stream',
  };
}

describe('LiveGateway subscribe/unsubscribe contract (architecture/live-signal-server.md §3.5)', () => {
  it('only forwards candle frames for a topic the client has subscribed to', () => {
    const gateway = makeGateway();
    const client = new FakeSocket();
    gateway.handleConnection(client as never, { url: '/' } as never);

    gateway.onCandleClosed(new CandleClosedEvent(candle('binance:BTCUSDT', '1m', true)));
    expect(client.sent).toHaveLength(0);

    client.emitMessage({ type: 'subscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
    gateway.onCandleClosed(new CandleClosedEvent(candle('binance:BTCUSDT', '1m', true)));
    expect(client.sent.some((m: unknown) => (m as { type: string }).type === 'candle')).toBe(true);

    // a different timeframe on the same instrument must not leak through
    client.sent.length = 0;
    gateway.onCandleClosed(new CandleClosedEvent(candle('binance:BTCUSDT', '5m', true)));
    expect(client.sent.filter((m: unknown) => (m as { type: string }).type === 'candle')).toHaveLength(0);
  });

  it('stops forwarding after unsubscribe', () => {
    const gateway = makeGateway();
    const client = new FakeSocket();
    gateway.handleConnection(client as never, { url: '/' } as never);

    client.emitMessage({ type: 'subscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
    client.emitMessage({ type: 'unsubscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
    client.sent.length = 0;

    gateway.onCandleClosed(new CandleClosedEvent(candle('binance:BTCUSDT', '1m', true)));
    expect(client.sent.filter((m: unknown) => (m as { type: string }).type === 'candle')).toHaveLength(0);
  });

  it('responds to ping with pong', () => {
    const gateway = makeGateway();
    const client = new FakeSocket();
    gateway.handleConnection(client as never, { url: '/' } as never);

    client.emitMessage({ type: 'ping' });
    expect(client.sent).toEqual([expect.objectContaining({ type: 'pong' })]);
  });

  it('routes signal frames only to clients subscribed to that instrument', () => {
    const gateway = makeGateway();
    const subscribed = new FakeSocket();
    const unsubscribed = new FakeSocket();
    gateway.handleConnection(subscribed as never, { url: '/' } as never);
    gateway.handleConnection(unsubscribed as never, { url: '/' } as never);
    subscribed.emitMessage({ type: 'subscribe', topic: 'signals', instrument: 'binance:BTCUSDT' });

    gateway.onSignalEmitted({
      signal: {
        id: '1',
        strategyId: 'x',
        instrument: 'binance:BTCUSDT',
        timeframe: '1m',
        time: 0,
        tier: 'demo',
        kind: 'info',
        direction: 'flat',
        overlay: [],
        meta: {},
      },
    } as never);

    expect(subscribed.sent.some((m: unknown) => (m as { type: string }).type === 'signal')).toBe(true);
    expect(unsubscribed.sent.some((m: unknown) => (m as { type: string }).type === 'signal')).toBe(false);
  });

  it('routes indicator frames only to clients subscribed to that instrument, on the same signals topic (architecture/live-signal-server.md §11.5)', () => {
    const gateway = makeGateway();
    const subscribed = new FakeSocket();
    const unsubscribed = new FakeSocket();
    gateway.handleConnection(subscribed as never, { url: '/' } as never);
    gateway.handleConnection(unsubscribed as never, { url: '/' } as never);
    subscribed.emitMessage({ type: 'subscribe', topic: 'signals', instrument: 'capitalcom:US100' });

    gateway.onIndicatorEmitted({
      point: {
        strategyId: 'vwap-band-reversal',
        instrument: 'capitalcom:US100',
        timeframe: '1m',
        tier: 'research',
        seriesId: 'vwap-band',
        time: 0,
        values: { vwap: 19000, vwapTop: 19010, vwapBottom: 18990 },
      },
    } as never);

    expect(subscribed.sent.some((m: unknown) => (m as { type: string }).type === 'indicator')).toBe(true);
    expect(unsubscribed.sent.some((m: unknown) => (m as { type: string }).type === 'indicator')).toBe(false);
  });

  it('only forwards metric frames for a topic the client has subscribed to (architecture/chart-layouts.md §4.5)', () => {
    const gateway = makeGateway();
    const client = new FakeSocket();
    gateway.handleConnection(client as never, { url: '/' } as never);

    observe(gateway, observation('binance:BTCUSDT', 60_000, 100));
    expect(client.sent).toHaveLength(0);

    client.emitMessage({
      type: 'subscribe',
      topic: 'metrics',
      instrument: 'binance:BTCUSDT',
      metric: 'openInterest',
      timeframe: '1m',
    });
    observe(gateway, observation('binance:BTCUSDT', 60_000, 100));
    const frames = client.sent.filter((m: unknown) => (m as { type: string }).type === 'metric');
    expect(frames).toHaveLength(1);
    expect((frames[0] as { point: { time: number; value: number; timeframe: string } }).point).toEqual(
      expect.objectContaining({ time: 60_000, value: 100, unit: 'base', timeframe: '1m' }),
    );

    // a different instrument must not leak through
    client.sent.length = 0;
    observe(gateway, observation('binance:ETHUSDT', 60_000, 5));
    expect(client.sent.filter((m: unknown) => (m as { type: string }).type === 'metric')).toHaveLength(0);
  });

  it('stops forwarding metric frames after unsubscribe', () => {
    const gateway = makeGateway();
    const client = new FakeSocket();
    gateway.handleConnection(client as never, { url: '/' } as never);

    client.emitMessage({
      type: 'subscribe',
      topic: 'metrics',
      instrument: 'binance:BTCUSDT',
      metric: 'openInterest',
      timeframe: '1m',
    });
    client.emitMessage({
      type: 'unsubscribe',
      topic: 'metrics',
      instrument: 'binance:BTCUSDT',
      metric: 'openInterest',
      timeframe: '1m',
    });
    client.sent.length = 0;

    observe(gateway, observation('binance:BTCUSDT', 60_000, 100));
    expect(client.sent.filter((m: unknown) => (m as { type: string }).type === 'metric')).toHaveLength(0);
  });

  it('bucketing a metric observation to two different subscribed timeframes fans out two frames', () => {
    const gateway = makeGateway();
    const oneMinSub = new FakeSocket();
    const fiveMinSub = new FakeSocket();
    gateway.handleConnection(oneMinSub as never, { url: '/' } as never);
    gateway.handleConnection(fiveMinSub as never, { url: '/' } as never);
    oneMinSub.emitMessage({
      type: 'subscribe',
      topic: 'metrics',
      instrument: 'binance:BTCUSDT',
      metric: 'openInterest',
      timeframe: '1m',
    });
    fiveMinSub.emitMessage({
      type: 'subscribe',
      topic: 'metrics',
      instrument: 'binance:BTCUSDT',
      metric: 'openInterest',
      timeframe: '5m',
    });

    observe(gateway, observation('binance:BTCUSDT', 62_000, 100));

    const oneMinFrame = oneMinSub.sent.find((m: unknown) => (m as { type: string }).type === 'metric') as {
      point: { time: number; timeframe: string };
    };
    const fiveMinFrame = fiveMinSub.sent.find((m: unknown) => (m as { type: string }).type === 'metric') as {
      point: { time: number; timeframe: string };
    };
    expect(oneMinFrame.point).toEqual(expect.objectContaining({ time: 60_000, timeframe: '1m' }));
    expect(fiveMinFrame.point).toEqual(expect.objectContaining({ time: 0, timeframe: '5m' }));
  });

  it('throttles forming-bar frames to at most ~4/s per topic', () => {
    jest.useFakeTimers();
    const gateway = makeGateway();
    const client = new FakeSocket();
    gateway.handleConnection(client as never, { url: '/' } as never);
    client.emitMessage({ type: 'subscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });

    for (let i = 0; i < 10; i++) {
      gateway.onCandleForming(new CandleFormingEvent(candle('binance:BTCUSDT', '1m', false)));
    }
    const formingFrames = client.sent.filter((m: unknown) => (m as { type: string }).type === 'candle');
    expect(formingFrames.length).toBe(1);
    jest.useRealTimers();
  });
});

describe('LiveGateway forming metric point (architecture/chart-layouts.md §11.2)', () => {
  const M = 60_000;
  const emptyStore = { query: async () => [], upsert: async () => undefined, latestTime: async () => null };

  function subscribe(client: FakeSocket, timeframe: string): void {
    client.emitMessage({ type: 'subscribe', topic: 'metrics', instrument: 'binance:BTCUSDT', metric: 'openInterest', timeframe });
  }

  function lastPoint(client: FakeSocket): Record<string, unknown> {
    const frames = client.sent.filter((m: unknown) => (m as { type: string }).type === 'metric') as { point: Record<string, unknown> }[];
    return frames[frames.length - 1].point;
  }

  function seed(gateway: ReturnType<typeof makeGateway>): void {
    // history rows every 5 m with a venue notional, then 1 m live snapshots in the forming bucket
    for (let i = 0; i < 6; i++) {
      gateway.cache.upsert({ ...observation('binance:BTCUSDT', i * 5 * M, 100 + i), notional: 1000 + i, notionalBasis: 'venue' });
    }
  }

  it('builds the forming bucket from MetricCache, not from the single observation', () => {
    const gateway = makeGateway();
    const client = new FakeSocket();
    gateway.handleConnection(client as never, { url: '/' } as never);
    subscribe(client, '15m');
    seed(gateway);

    // Rows at 0..25 m are 100..105; the 15m bucket's predecessor (0–15 m) closes at 102.
    observe(gateway, observation('binance:BTCUSDT', 16 * M + 2000, 90));
    // 15–20 m sub-bucket: the 15 m row then the 16 m tip → the tip is the sample; open = 102.
    expect(lastPoint(client)).toEqual(
      expect.objectContaining({ time: 15 * M, value: 90, ohlc: { open: 102, high: 102, low: 90, close: 90 }, samples: 1 }),
    );

    observe(gateway, observation('binance:BTCUSDT', 21 * M + 2000, 95));
    // a second poll must extend the forming candle, not replace it with a flat one
    expect(lastPoint(client)).toEqual(
      expect.objectContaining({ time: 15 * M, value: 95, ohlc: { open: 102, high: 102, low: 90, close: 95 }, samples: 2 }),
    );
  });

  it('the WS point for a bucket equals the REST point for the same bucket', async () => {
    const gateway = makeGateway();
    const client = new FakeSocket();
    gateway.handleConnection(client as never, { url: '/' } as never);
    const controller = new MetricsController(gateway.cache, emptyStore as never);
    seed(gateway);

    for (const tf of ['1m', '5m', '15m', '1h'] as const) {
      client.sent.length = 0;
      subscribe(client, tf);
      observe(gateway, observation('binance:BTCUSDT', 27 * M + 2000, 111));
      const rest = await controller.get({
        instrument: 'binance:BTCUSDT',
        metric: 'openInterest',
        timeframe: tf,
        from: 0,
        to: 27 * M + 2000,
        limit: 1500,
      });
      expect(lastPoint(client)).toEqual(JSON.parse(JSON.stringify(rest[rest.length - 1])));
      client.emitMessage({ type: 'unsubscribe', topic: 'metrics', instrument: 'binance:BTCUSDT', metric: 'openInterest', timeframe: tf });
    }
  });
});

describe('MetricsController lead bucket (architecture/chart-layouts.md §11.2)', () => {
  const M = 60_000;

  it('opens the first returned bucket at its predecessor\'s close and drops the predecessor', async () => {
    const cache = new MetricCache();
    for (let i = 0; i < 12; i++) cache.upsert(observation('binance:BTCUSDT', i * 5 * M, 100 + i));
    const store = { query: async () => [], upsert: async () => undefined, latestTime: async () => null };
    const controller = new MetricsController(cache, store as never);
    const query = { instrument: 'binance:BTCUSDT', metric: 'openInterest', timeframe: '15m', limit: 1500 } as const;

    const page = await controller.get({ ...query, from: 15 * M, to: 60 * M });
    expect(page.map((p) => p.time)).toEqual([15 * M, 30 * M, 45 * M]);
    const full = await controller.get({ ...query, from: 0, to: 60 * M });
    // the first candle of the page equals the same candle fetched mid-page
    expect(page[0]).toEqual(full[1]);
    expect(page[0].ohlc.open).toBe(102);
  });
});

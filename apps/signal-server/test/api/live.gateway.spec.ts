import { LiveGateway } from '../../src/api/ws/live.gateway';
import { CandleClosedEvent, CandleFormingEvent } from '../../src/market-data/market-data.events';
import { Candle } from '@trade-automation/contracts';

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
    const gateway = new LiveGateway(fakeStatus(), fakeConfig(), fakeMetrics());
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
    const gateway = new LiveGateway(fakeStatus(), fakeConfig(), fakeMetrics());
    const client = new FakeSocket();
    gateway.handleConnection(client as never, { url: '/' } as never);

    client.emitMessage({ type: 'subscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
    client.emitMessage({ type: 'unsubscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
    client.sent.length = 0;

    gateway.onCandleClosed(new CandleClosedEvent(candle('binance:BTCUSDT', '1m', true)));
    expect(client.sent.filter((m: unknown) => (m as { type: string }).type === 'candle')).toHaveLength(0);
  });

  it('responds to ping with pong', () => {
    const gateway = new LiveGateway(fakeStatus(), fakeConfig(), fakeMetrics());
    const client = new FakeSocket();
    gateway.handleConnection(client as never, { url: '/' } as never);

    client.emitMessage({ type: 'ping' });
    expect(client.sent).toEqual([expect.objectContaining({ type: 'pong' })]);
  });

  it('routes signal frames only to clients subscribed to that instrument', () => {
    const gateway = new LiveGateway(fakeStatus(), fakeConfig(), fakeMetrics());
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
    const gateway = new LiveGateway(fakeStatus(), fakeConfig(), fakeMetrics());
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

  it('throttles forming-bar frames to at most ~4/s per topic', () => {
    jest.useFakeTimers();
    const gateway = new LiveGateway(fakeStatus(), fakeConfig(), fakeMetrics());
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

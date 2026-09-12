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

    expect(rest.getSignals).toHaveBeenCalledWith('binance:BTCUSDT');
    expect(rest.getIndicators).toHaveBeenCalledWith('binance:BTCUSDT');
    const sent = sockets[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'subscribe', topic: 'signals', instrument: 'binance:BTCUSDT' });
    expect(sent).toContainEqual({ type: 'subscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
  });

  it('a metric panel fetches/subscribes metrics, never candles', async () => {
    const rest = fakeRest();
    const feed = new PanelFeed(metricPanel(), '1m', { rest, socket: live });
    await feed.start();

    expect(rest.getCandles).not.toHaveBeenCalled();
    expect(rest.getMetrics).toHaveBeenCalledWith('binance:BTCUSDT', 'openInterest', '1m', undefined, undefined, 1500);
    const sent = sockets[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({
      type: 'subscribe',
      topic: 'metrics',
      instrument: 'binance:BTCUSDT',
      metric: 'openInterest',
      timeframe: '1m',
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
});

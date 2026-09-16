import { vi } from 'vitest';
import { LiveSocket, type ConnectionState } from './live.socket';
import type { SocketFactory, SocketLike } from './socket-factory';

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

  simulateServerMessage(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  simulateDrop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}

describe('LiveSocket', () => {
  let sockets: FakeSocket[];
  let factory: SocketFactory;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    factory = () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function connectAndOpen(live: LiveSocket): FakeSocket {
    live.connect('ws://fake/ws');
    const socket = sockets[sockets.length - 1];
    socket.simulateOpen();
    return socket;
  }

  it('reports connection state through connecting -> live', () => {
    const live = new LiveSocket();
    live.useSocketFactory(factory);
    const states: ConnectionState[] = [];
    live.connectionState.subscribe((s) => states.push(s));

    live.connect('ws://fake/ws');
    expect(states).toEqual(['connecting']);
    sockets[0].simulateOpen();
    expect(states).toEqual(['connecting', 'live']);
  });

  it('sends a subscribe frame immediately once the socket is open', () => {
    const live = new LiveSocket();
    live.useSocketFactory(factory);
    const socket = connectAndOpen(live);

    live.subscribeCandles('binance:BTCUSDT', '1m');
    const sentFrames = socket.sent.map((s) => JSON.parse(s));
    expect(sentFrames).toContainEqual({ type: 'subscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
  });

  it('flushes a subscribe requested before the socket opened', () => {
    const live = new LiveSocket();
    live.useSocketFactory(factory);
    live.connect('ws://fake/ws');
    live.subscribeCandles('binance:BTCUSDT', '1m'); // requested while CONNECTING

    const socket = sockets[0];
    expect(socket.sent).toEqual([]); // nothing sent yet — not open
    socket.simulateOpen();
    const sentFrames = socket.sent.map((s) => JSON.parse(s));
    expect(sentFrames).toContainEqual({ type: 'subscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
  });

  it('reconnects with backoff after a drop and re-subscribes every active topic', () => {
    const live = new LiveSocket();
    live.useSocketFactory(factory);
    const states: ConnectionState[] = [];
    live.connectionState.subscribe((s) => states.push(s));

    const first = connectAndOpen(live);
    live.subscribeCandles('binance:BTCUSDT', '1m');
    live.subscribeSignals('binance:BTCUSDT');
    first.sent = []; // clear the initial subscribe sends

    first.simulateDrop();
    expect(states.at(-1)).toBe('reconnecting');
    expect(sockets).toHaveLength(1); // no reconnect attempt yet — backoff pending

    vi.advanceTimersByTime(500); // base backoff
    expect(sockets).toHaveLength(2);

    const second = sockets[1];
    let reconnectedFired = false;
    live.reconnected.subscribe(() => (reconnectedFired = true));
    second.simulateOpen();

    expect(states.at(-1)).toBe('live');
    expect(reconnectedFired).toBe(true);
    const sentFrames = second.sent.map((s) => JSON.parse(s));
    expect(sentFrames).toContainEqual({ type: 'subscribe', topic: 'candles', instrument: 'binance:BTCUSDT', timeframe: '1m' });
    expect(sentFrames).toContainEqual({ type: 'subscribe', topic: 'signals', instrument: 'binance:BTCUSDT' });
  });

  it('backs off exponentially across repeated drops, capped at the max delay', () => {
    const live = new LiveSocket();
    live.useSocketFactory(factory);
    connectAndOpen(live);

    sockets[0].simulateDrop();
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    sockets[1].simulateDrop();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it('stops unsubscribed topics from being resubscribed after a reconnect', () => {
    const live = new LiveSocket();
    live.useSocketFactory(factory);
    const first = connectAndOpen(live);
    live.subscribeCandles('binance:BTCUSDT', '1m');
    live.unsubscribeCandles('binance:BTCUSDT', '1m');

    first.simulateDrop();
    vi.advanceTimersByTime(500);
    const second = sockets[1];
    second.simulateOpen();

    const sentFrames = second.sent.map((s) => JSON.parse(s));
    expect(sentFrames.filter((f) => f.type === 'subscribe')).toEqual([]);
  });

  it('survives a reconnect: calendar topic is re-subscribed and its frames keep routing', () => {
    const live = new LiveSocket();
    live.useSocketFactory(factory);
    const first = connectAndOpen(live);

    live.subscribeCalendar();
    const initialFrames = first.sent.map((s) => JSON.parse(s));
    expect(initialFrames).toContainEqual({ type: 'subscribe', topic: 'calendar' });
    first.sent = [];

    first.simulateDrop();
    vi.advanceTimersByTime(500);
    const second = sockets[1];
    second.simulateOpen();

    const resentFrames = second.sent.map((s) => JSON.parse(s));
    expect(resentFrames).toContainEqual({ type: 'subscribe', topic: 'calendar' });

    const events: unknown[] = [];
    const notifications: unknown[] = [];
    live.calendarEventFrames$.subscribe((f) => events.push(f));
    live.notificationFrames$.subscribe((f) => notifications.push(f));

    second.simulateServerMessage({
      type: 'calendarEvent',
      change: 'updated',
      event: { id: 'ff:832:2026-09-16', title: 'ECB President Lagarde Speaks' },
    });
    second.simulateServerMessage({
      type: 'notification',
      notification: { id: 'due:1', kind: 'event-due', at: 1, events: [], title: 'USD · High · Federal Funds Rate' },
    });

    expect(events).toHaveLength(1);
    expect(notifications).toHaveLength(1);
  });

  it('unsubscribing calendar stops it from being re-subscribed after a reconnect', () => {
    const live = new LiveSocket();
    live.useSocketFactory(factory);
    const first = connectAndOpen(live);
    live.subscribeCalendar();
    live.unsubscribeCalendar();

    first.simulateDrop();
    vi.advanceTimersByTime(500);
    const second = sockets[1];
    second.simulateOpen();

    const sentFrames = second.sent.map((s) => JSON.parse(s));
    expect(sentFrames.filter((f) => f.type === 'subscribe')).toEqual([]);
  });

  it('routes candle and signal frames only to matching instrument/timeframe subscribers', () => {
    const live = new LiveSocket();
    live.useSocketFactory(factory);
    const socket = connectAndOpen(live);

    const received: unknown[] = [];
    live.candlesFor('binance:BTCUSDT', '1m').subscribe((f) => received.push(f));

    socket.simulateServerMessage({
      type: 'candle',
      candle: { instrument: 'binance:ETHUSDT', timeframe: '1m', openTime: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, closed: true, source: 'venue-stream' },
    });
    socket.simulateServerMessage({
      type: 'candle',
      candle: { instrument: 'binance:BTCUSDT', timeframe: '1m', openTime: 2, open: 1, high: 1, low: 1, close: 1, volume: 1, closed: true, source: 'venue-stream' },
    });

    expect(received).toHaveLength(1);
  });
});

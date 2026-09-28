import {
  INITIAL_BACKOFF_MS, MAX_BACKOFF_MS, MAX_STREAMS_PER_SOCKET, PerpSocket,
  combinedStreamUrl, demultiplex, perpStreamNames, type WebSocketLike,
} from '../../../src/collectors/binance-perp/perp-socket';

/** IB-005 — the combined-stream socket: URL, demultiplexing, and reconnect backoff. No network. */

function fakeSocket() {
  const listeners = new Map<string, (arg?: unknown) => void>();
  const state = { closed: 0 };
  const socket: WebSocketLike = {
    on(event: string, listener: (...args: never[]) => void) {
      listeners.set(event, listener as (arg?: unknown) => void);
      return socket;
    },
    close() {
      state.closed++;
    },
  };
  return { socket, state, emit: (event: string, arg?: unknown) => listeners.get(event)?.(arg) };
}

describe('combinedStreamUrl / perpStreamNames (§4.1)', () => {
  it('one socket carries a kline per symbol plus the two array streams, lower-cased', () => {
    expect(perpStreamNames(['BTCUSDT', 'ETHUSDT'])).toEqual([
      'btcusdt@kline_1m', 'ethusdt@kline_1m', '!markPrice@arr@1s', '!forceOrder@arr',
    ]);
  });

  it('builds the combined form even for a single stream', () => {
    expect(combinedStreamUrl('wss://fstream.binance.com', ['btcusdt@kline_1m'])).toBe(
      'wss://fstream.binance.com/stream?streams=btcusdt@kline_1m',
    );
    expect(combinedStreamUrl('wss://fstream.binance.com', ['a', 'b'])).toBe('wss://fstream.binance.com/stream?streams=a/b');
  });

  it("refuses an empty list and more streams than Binance's per-socket cap", () => {
    expect(() => combinedStreamUrl('wss://x', [])).toThrow(RangeError);
    const tooMany = Array.from({ length: MAX_STREAMS_PER_SOCKET + 1 }, (_, i) => `s${i}`);
    expect(() => combinedStreamUrl('wss://x', tooMany)).toThrow(/1024/);
  });

  it('a 30-symbol universe fits comfortably', () => {
    expect(perpStreamNames(Array.from({ length: 30 }, (_, i) => `SYM${i}USDT`))).toHaveLength(32);
  });
});

describe('demultiplex', () => {
  it('unwraps the combined envelope', () => {
    expect(demultiplex({ stream: 'btcusdt@kline_1m', data: { e: 'kline' } })).toEqual({ stream: 'btcusdt@kline_1m', data: { e: 'kline' } });
  });

  it('passes a raw single-stream payload through under its own event name', () => {
    const raw = { e: 'markPriceUpdate', s: 'BTCUSDT' };
    expect(demultiplex(raw)).toEqual({ stream: 'markPriceUpdate', data: raw });
  });

  it('ignores anything that is neither', () => {
    for (const value of [null, 42, 'hello', {}, { stream: 5 }]) expect(demultiplex(value)).toBeNull();
  });
});

describe('PerpSocket', () => {
  it('forwards demultiplexed messages and reports open/close/error', () => {
    const fake = fakeSocket();
    const seen: Array<[string, unknown]> = [];
    const events: string[] = [];
    const socket = new PerpSocket({
      wsBaseUrl: 'wss://fstream.binance.com',
      streams: ['btcusdt@kline_1m'],
      factory: () => fake.socket,
      handlers: {
        onOpen: () => events.push('open'),
        onMessage: (stream, data) => seen.push([stream, data]),
        onClose: (code) => events.push(`close:${code}`),
        onError: (message) => events.push(`error:${message}`),
      },
    });

    socket.open();
    fake.emit('open');
    fake.emit('message', JSON.stringify({ stream: 'btcusdt@kline_1m', data: { e: 'kline', k: { t: 1 } } }));
    fake.emit('message', 'not json'); // ignored, never thrown
    fake.emit('error', new Error('boom'));

    expect(events).toEqual(['open', 'error:boom']);
    expect(seen).toEqual([['btcusdt@kline_1m', { e: 'kline', k: { t: 1 } }]]);
    socket.stop();
  });

  it('reconnects after a close with a doubling backoff, capped, and stop() ends it', () => {
    jest.useFakeTimers();
    try {
      const made: ReturnType<typeof fakeSocket>[] = [];
      const socket = new PerpSocket({
        wsBaseUrl: 'wss://fstream.binance.com',
        streams: ['btcusdt@kline_1m'],
        factory: () => {
          const f = fakeSocket();
          made.push(f);
          return f.socket;
        },
        handlers: { onOpen: () => undefined, onMessage: () => undefined, onClose: () => undefined, onError: () => undefined },
      });

      socket.open();
      expect(made).toHaveLength(1);

      made[0].emit('close', 1006);
      jest.advanceTimersByTime(INITIAL_BACKOFF_MS - 1);
      expect(made).toHaveLength(1); // not yet
      jest.advanceTimersByTime(1);
      expect(made).toHaveLength(2); // 1 s later

      made[1].emit('close', 1006);
      jest.advanceTimersByTime(2 * INITIAL_BACKOFF_MS);
      expect(made).toHaveLength(3); // 2 s

      // …and a successful open resets the backoff to 1 s again
      made[2].emit('open');
      made[2].emit('close', 1006);
      jest.advanceTimersByTime(INITIAL_BACKOFF_MS);
      expect(made).toHaveLength(4);

      socket.stop();
      made[3].emit('close', 1006);
      jest.advanceTimersByTime(MAX_BACKOFF_MS * 2);
      expect(made).toHaveLength(4); // stopped for good
    } finally {
      jest.useRealTimers();
    }
  });

  it('opening again closes the socket it replaces (the degraded retry)', () => {
    const made: ReturnType<typeof fakeSocket>[] = [];
    const socket = new PerpSocket({
      wsBaseUrl: 'wss://x',
      streams: ['a'],
      factory: () => {
        const f = fakeSocket();
        made.push(f);
        return f.socket;
      },
      handlers: { onOpen: () => undefined, onMessage: () => undefined, onClose: () => undefined, onError: () => undefined },
    });
    socket.open();
    socket.open();
    expect(made).toHaveLength(2);
    expect(made[0].state.closed).toBe(1);
    socket.stop();
  });
});

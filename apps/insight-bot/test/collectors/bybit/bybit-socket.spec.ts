import {
  BybitSocket, INITIAL_BACKOFF_MS, MAX_TOPICS_PER_FRAME, PING_MS, SILENCE_MS, chunkTopics, type WebSocketLike,
} from '../../../src/collectors/bybit/bybit-socket';
import { LIQUIDATIONS } from './fixtures';

/** IB-008 — the Bybit protocol: subscribe frames, the client ping, acks vs data, silence, backoff. */

function fakeSocket() {
  const listeners = new Map<string, (arg?: unknown) => void>();
  const sent: string[] = [];
  const state = { closed: 0 };
  const socket: WebSocketLike = {
    on(event: string, listener: (...args: never[]) => void) {
      listeners.set(event, listener as (arg?: unknown) => void);
      return socket;
    },
    send(data: string) {
      sent.push(data);
    },
    close() {
      state.closed++;
    },
  };
  return { socket, sent, state, emit: (event: string, arg?: unknown) => listeners.get(event)?.(arg) };
}

function harness(topics: string[], over: Record<string, unknown> = {}) {
  const made: ReturnType<typeof fakeSocket>[] = [];
  const events: string[] = [];
  const data: unknown[] = [];
  let now = 1_790_608_000_000;
  const socket = new BybitSocket({
    url: 'wss://stream.bybit.com/v5/public/linear',
    topics,
    factory: () => {
      const f = fakeSocket();
      made.push(f);
      return f.socket;
    },
    now: () => now,
    handlers: {
      onOpen: () => events.push('open'),
      onMessage: (payload) => data.push(payload),
      onClose: (code) => events.push(`close:${code}`),
      onError: (message) => events.push(`error:${message}`),
      onSubscribeFailed: (message) => events.push(`refused:${message}`),
    },
    ...over,
  });
  return { socket, made, events, data, advance: (ms: number) => (now += ms), at: (ms: number) => (now = ms) };
}

describe('chunkTopics', () => {
  it('splits a 30-symbol universe into frames the venue accepts', () => {
    const topics = Array.from({ length: 60 }, (_, i) => `tickers.SYM${i}`);
    const chunks = chunkTopics(topics);
    expect(chunks).toHaveLength(6);
    expect(chunks.every((c) => c.length <= MAX_TOPICS_PER_FRAME)).toBe(true);
    expect(chunks.flat()).toEqual(topics);
  });
});

describe('BybitSocket', () => {
  it('subscribes in chunks on open and pings every 20 s', () => {
    jest.useFakeTimers();
    try {
      const h = harness(['tickers.BTCUSDT', 'allLiquidation.BTCUSDT']);
      h.socket.open();
      h.made[0].emit('open');

      expect(JSON.parse(h.made[0].sent[0])).toEqual({ op: 'subscribe', args: ['tickers.BTCUSDT', 'allLiquidation.BTCUSDT'] });
      expect(h.events).toEqual(['open']);

      jest.advanceTimersByTime(PING_MS);
      expect(JSON.parse(h.made[0].sent[1])).toEqual({ op: 'ping' });
      jest.advanceTimersByTime(PING_MS);
      expect(h.made[0].sent).toHaveLength(3);
      h.socket.stop();
      jest.advanceTimersByTime(PING_MS * 3);
      expect(h.made[0].sent).toHaveLength(3); // stopped means stopped
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes data through and swallows acks', () => {
    const h = harness(['allLiquidation.ETHUSDT']);
    h.socket.open();
    h.made[0].emit('open');
    h.made[0].emit('message', JSON.stringify({ success: true, ret_msg: '', op: 'subscribe' }));
    h.made[0].emit('message', JSON.stringify({ success: true, ret_msg: 'pong', op: 'ping' }));
    h.made[0].emit('message', JSON.stringify(LIQUIDATIONS[0]));
    h.made[0].emit('message', 'not json');

    expect(h.data).toEqual([LIQUIDATIONS[0]]);
    h.socket.stop();
  });

  it('a refused subscription is reported loudly — the retired liquidation.{symbol} case', () => {
    const h = harness(['liquidation.BTCUSDT']);
    h.socket.open();
    h.made[0].emit('open');
    h.made[0].emit('message', JSON.stringify({ success: false, ret_msg: 'error:handler not found,topic:liquidation.BTCUSDT', op: 'subscribe' }));

    expect(h.events).toContain('refused:error:handler not found,topic:liquidation.BTCUSDT');
    expect(h.data).toEqual([]);
    h.socket.stop();
  });

  it('checkSilence reconnects after 90 s without a message, and not before', () => {
    const h = harness(['tickers.BTCUSDT']);
    h.socket.open();
    h.made[0].emit('open');
    h.made[0].emit('message', JSON.stringify(LIQUIDATIONS[0]));

    h.advance(SILENCE_MS - 1);
    expect(h.socket.checkSilence()).toBe(false);
    expect(h.made).toHaveLength(1);

    h.advance(1);
    expect(h.socket.checkSilence()).toBe(true);
    expect(h.made).toHaveLength(2); // a fresh socket
    expect(h.events.some((e) => e.startsWith('error:no message for'))).toBe(true);

    expect(h.socket.checkSilence()).toBe(false); // the new socket gets its own window
    h.socket.stop();
  });

  it('reconnects after a close with a doubling backoff', () => {
    jest.useFakeTimers();
    try {
      const h = harness(['tickers.BTCUSDT']);
      h.socket.open();
      h.made[0].emit('close', 1006);
      jest.advanceTimersByTime(INITIAL_BACKOFF_MS);
      expect(h.made).toHaveLength(2);

      h.made[1].emit('close', 1006);
      jest.advanceTimersByTime(INITIAL_BACKOFF_MS);
      expect(h.made).toHaveLength(2); // 2 s this time, not 1
      jest.advanceTimersByTime(INITIAL_BACKOFF_MS);
      expect(h.made).toHaveLength(3);

      h.socket.stop();
      h.made[2].emit('close', 1006);
      jest.advanceTimersByTime(60_000);
      expect(h.made).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

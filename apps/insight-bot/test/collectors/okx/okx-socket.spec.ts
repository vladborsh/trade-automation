import {
  OkxSocket,
  OkxSocketHandlers,
  PING_TEXT,
  PONG_TEXT,
  SILENCE_MS,
  WebSocketLike,
} from '../../../src/collectors/okx/okx-socket';

/** A socket stand-in: records what was sent and lets the test fire events. */
class FakeWs implements WebSocketLike {
  readonly sent: string[] = [];
  closed = false;
  terminated = false;
  private readonly listeners = new Map<string, (...args: never[]) => void>();
  on(event: string, listener: (...args: never[]) => void): unknown {
    this.listeners.set(event, listener);
    return this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  terminate(): void {
    this.terminated = true;
  }
  fire(event: 'open' | 'message' | 'close' | 'error', arg?: unknown): void {
    this.listeners.get(event)?.(arg as never);
  }
}

function build(overrides: Partial<OkxSocketHandlers> = {}, now = () => 1_000) {
  const events: string[] = [];
  const sockets: FakeWs[] = [];
  const messages: Array<{ channel: string; data: unknown[] }> = [];
  const handlers: OkxSocketHandlers = {
    onOpen: () => events.push('open'),
    onMessage: (channel, data) => messages.push({ channel, data }),
    onVenueError: (code, message) => events.push(`venue-error:${code}:${message}`),
    onClose: (code) => events.push(`close:${code}`),
    onError: (message) => events.push(`error:${message}`),
    ...overrides,
  };
  const socket = new OkxSocket({
    wsUrl: 'wss://ws.okx.test/v5/public',
    subscriptions: [
      { channel: 'liquidation-orders', instType: 'SWAP' },
      { channel: 'mark-price', instId: 'BTC-USDT-SWAP' },
    ],
    handlers,
    factory: () => {
      const ws = new FakeWs();
      sockets.push(ws);
      return ws;
    },
    now,
  });
  return { socket, sockets, events, messages };
}

describe('OkxSocket subscription', () => {
  it('sends one subscribe frame carrying every channel', () => {
    const { socket, sockets } = build();
    socket.open();
    sockets[0].fire('open');
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      op: 'subscribe',
      args: [
        { channel: 'liquidation-orders', instType: 'SWAP' },
        { channel: 'mark-price', instId: 'BTC-USDT-SWAP' },
      ],
    });
  });

  it('builds the frame the venue accepted live', () => {
    expect(OkxSocket.subscribeFrame([{ channel: 'funding-rate', instId: 'ETH-USDT-SWAP' }])).toBe(
      '{"op":"subscribe","args":[{"channel":"funding-rate","instId":"ETH-USDT-SWAP"}]}',
    );
  });
});

describe('OkxSocket message handling', () => {
  it('delivers a data message with its channel', () => {
    const { socket, sockets, messages } = build();
    socket.open();
    sockets[0].fire('open');
    sockets[0].fire('message', JSON.stringify({ arg: { channel: 'mark-price', instId: 'BTC-USDT-SWAP' }, data: [{ markPx: '1' }] }));
    expect(messages).toEqual([{ channel: 'mark-price', data: [{ markPx: '1' }] }]);
  });

  it('ignores subscribe acknowledgements — they are not data', () => {
    const { socket, sockets, messages } = build();
    socket.open();
    sockets[0].fire('open');
    sockets[0].fire('message', JSON.stringify({ event: 'subscribe', arg: { channel: 'mark-price' }, connId: 'x' }));
    expect(messages).toEqual([]);
  });

  it("reports the venue's own error frame", () => {
    const { socket, sockets, events } = build();
    socket.open();
    sockets[0].fire('open');
    sockets[0].fire('message', JSON.stringify({ event: 'error', code: '60012', msg: 'Invalid request' }));
    expect(events).toContain('venue-error:60012:Invalid request');
  });

  it('reports an unparseable frame rather than throwing', () => {
    const { socket, sockets, events } = build();
    socket.open();
    sockets[0].fire('open');
    expect(() => sockets[0].fire('message', 'not json')).not.toThrow();
    expect(events.some((e) => e.startsWith('error:unparseable frame'))).toBe(true);
  });
});

describe('OkxSocket heartbeat and the silence watchdog', () => {
  it('sends the text ping, not a JSON op — OKX wants the bare word', () => {
    jest.useFakeTimers();
    try {
      const { socket, sockets } = build();
      socket.open();
      sockets[0].fire('open');
      jest.advanceTimersByTime(25_000);
      expect(sockets[0].sent).toContain(PING_TEXT);
      expect(sockets[0].sent.filter((s) => s === PING_TEXT)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a pong does NOT count as venue data, so a mute socket still trips the watchdog', () => {
    let clock = 1_000;
    const { socket, sockets } = build({}, () => clock);
    socket.open();
    sockets[0].fire('open'); // lastMessage = 1000

    clock += SILENCE_MS - 1;
    sockets[0].fire('message', PONG_TEXT); // answering, but publishing nothing
    clock += 2;

    expect(socket.checkSilence(clock)).toBe(true);
    expect(sockets[0].terminated).toBe(true);
  });

  it('real data resets the watchdog', () => {
    let clock = 1_000;
    const { socket, sockets } = build({}, () => clock);
    socket.open();
    sockets[0].fire('open');

    clock += SILENCE_MS - 1;
    sockets[0].fire('message', JSON.stringify({ arg: { channel: 'mark-price' }, data: [{}] }));
    clock += 2;
    expect(socket.checkSilence(clock)).toBe(false);

    clock += SILENCE_MS + 1;
    expect(socket.checkSilence(clock)).toBe(true);
  });

  it('does not fire twice before the replacement socket has had its window', () => {
    let clock = 1_000;
    const { socket, sockets } = build({}, () => clock);
    socket.open();
    sockets[0].fire('open');
    clock += SILENCE_MS + 1;
    expect(socket.checkSilence(clock)).toBe(true);
    expect(socket.checkSilence(clock + 1)).toBe(false);
  });

  it('stays quiet once closed for good', () => {
    let clock = 1_000;
    const { socket, sockets } = build({}, () => clock);
    socket.open();
    sockets[0].fire('open');
    socket.close();
    clock += SILENCE_MS * 10;
    expect(socket.checkSilence(clock)).toBe(false);
  });
});

describe('OkxSocket reconnect', () => {
  it('reconnects with backoff after a close, and stops once closed for good', () => {
    jest.useFakeTimers();
    try {
      const { socket, sockets, events } = build();
      socket.open();
      sockets[0].fire('open');
      sockets[0].fire('close', 1006);
      expect(events).toContain('close:1006');

      jest.advanceTimersByTime(1_000);
      expect(sockets).toHaveLength(2); // reconnected

      socket.close();
      sockets[1].fire('close', 1000);
      jest.advanceTimersByTime(60_000);
      expect(sockets).toHaveLength(2); // no further attempt
    } finally {
      jest.useRealTimers();
    }
  });

  it('resets the backoff after a successful open', () => {
    jest.useFakeTimers();
    try {
      const { socket, sockets } = build();
      socket.open();
      sockets[0].fire('open');
      sockets[0].fire('close', 1006);
      jest.advanceTimersByTime(1_000);
      sockets[1].fire('open'); // success resets the backoff
      sockets[1].fire('close', 1006);
      jest.advanceTimersByTime(1_000);
      expect(sockets).toHaveLength(3); // 1 s again, not 2 s
    } finally {
      jest.useRealTimers();
    }
  });
});

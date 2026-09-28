import WebSocket from 'ws';

/**
 * IB-005, moved to `binance-common` by IB-006 — one combined-stream socket carrying a whole
 * universe (design §4.1 for perp, §4.2 for spot; the two differ only in the base URL and the
 * stream list its caller supplies).
 *
 * Why this is not `BinanceAdapter.streamKlines`: that helper opens a socket per instrument, drops
 * everything whose `e` is not `kline`, and tags every candle with the single instrument it was
 * given. This collector needs the opposite — **one** socket for 30 × `<sym>@kline_1m` plus
 * `!markPrice@arr@1s` and `!forceOrder@arr`, demultiplexed by the envelope's `stream` field. The
 * REST paginator and the kline mappers of `@trade-automation/binance-client` are reused as they are.
 *
 * Policy lives elsewhere on purpose: this class reports `open`, `message`, `close` and `error` and
 * knows nothing about degraded mode — `ModePolicy` decides, the collector acts. Reconnect backoff
 * (1 s doubling to 30 s) is here because it is socket mechanics, not policy.
 */

export interface BinanceSocketHandlers {
  /** The socket completed its handshake. */
  onOpen(): void;
  /** One demultiplexed payload: `stream` is e.g. `btcusdt@kline_1m`, `data` the event object. */
  onMessage(stream: string, data: unknown): void;
  onClose(code: number): void;
  onError(message: string): void;
}

export interface BinanceSocketOptions {
  /** e.g. `wss://fstream.binance.com` */
  wsBaseUrl: string;
  streams: readonly string[];
  handlers: BinanceSocketHandlers;
  /** Injected in specs; defaults to the real `ws` client. */
  factory?: (url: string) => WebSocketLike;
  now?: () => number;
}

/** The slice of `ws` this file uses, so a spec can hand in a fake without a server. */
export interface WebSocketLike {
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: never[]) => void): unknown;
  close(): void;
  terminate?(): void;
}

export const INITIAL_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;

/** Binance caps a combined socket at 1024 streams; the universe is 30 symbols + 2 array streams. */
export const MAX_STREAMS_PER_SOCKET = 1024;

export function combinedStreamUrl(wsBaseUrl: string, streams: readonly string[]): string {
  if (streams.length === 0) throw new RangeError('combinedStreamUrl: no streams');
  if (streams.length > MAX_STREAMS_PER_SOCKET) {
    throw new RangeError(`combinedStreamUrl: ${streams.length} streams exceeds Binance's ${MAX_STREAMS_PER_SOCKET} per socket`);
  }
  return `${wsBaseUrl}/stream?streams=${streams.join('/')}`;
}

/**
 * Unwraps the combined-stream envelope `{ stream, data }`. A raw (non-combined) payload is passed
 * through with its own `e` as the stream name, so a single-stream socket behaves the same.
 */
export function demultiplex(raw: unknown): { stream: string; data: unknown } | null {
  if (raw === null || typeof raw !== 'object') return null;
  const envelope = raw as { stream?: unknown; data?: unknown; e?: unknown };
  if (typeof envelope.stream === 'string' && envelope.data !== undefined) {
    return { stream: envelope.stream, data: envelope.data };
  }
  if (typeof envelope.e === 'string') return { stream: envelope.e, data: raw };
  return null;
}

export class BinanceSocket {
  private socket: WebSocketLike | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly factory: (url: string) => WebSocketLike;

  constructor(private readonly options: BinanceSocketOptions) {
    this.factory = options.factory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  }

  get url(): string {
    return combinedStreamUrl(this.options.wsBaseUrl, this.options.streams);
  }

  /** Opens the socket. Calling it while one is open closes the old one first (the degraded retry). */
  open(): void {
    this.stopped = false;
    this.closeSocket();
    const socket = this.factory(this.url);
    this.socket = socket;

    socket.on('open', (() => {
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.options.handlers.onOpen();
    }) as never);

    socket.on('message', ((payload: unknown) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(payload));
      } catch {
        return; // Binance sends JSON only; anything else is not ours to interpret
      }
      const message = demultiplex(parsed);
      if (message) this.options.handlers.onMessage(message.stream, message.data);
    }) as never);

    socket.on('close', ((code: number) => {
      this.socket = null;
      this.options.handlers.onClose(typeof code === 'number' ? code : 0);
      // The 24 h server-side disconnect arrives here and is an ordinary reconnect (§4.1).
      this.scheduleReconnect();
    }) as never);

    socket.on('error', ((error: Error) => {
      this.options.handlers.onError(error?.message ?? 'socket error');
    }) as never);
  }

  /** Closes for good: no reconnect. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.closeSocket();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open();
    }, delay);
    // A pending reconnect must not hold the process open.
    (this.reconnectTimer as { unref?: () => void }).unref?.();
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      socket.terminate?.();
    }
  }
}

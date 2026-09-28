import WebSocket from 'ws';

/**
 * IB-009 — one public socket to `wss://ws.okx.com:8443/ws/v5/public` carrying every channel this
 * collector needs (design §4.3). Confirmed live 2026-09-28: `liquidation-orders` (instType
 * SWAP, one channel for all instruments), plus `mark-price` and `funding-rate` per `instId`,
 * all subscribed on the same connection and all delivering.
 *
 * Mechanics only — no write policy. Reconnect backoff and the silence watchdog live here, the
 * same division IB-008's `BybitSocket` settled on.
 *
 * **Dead-socket rule, as IB-005/IB-008: no message for `silenceMs` (90 s) → reconnect.** There is
 * deliberately no degraded REST mode: OKX's WS is reachable from the dev network (confirmed
 * 2026-09-28, unlike Binance's fstream), and `liquidation-orders` has no REST equivalent at all,
 * so a silent socket is a reconnect, not a fallback. `checkSilence()` is called by the service's
 * one-second tick rather than owning a timer, so a spec can drive it.
 *
 * **The heartbeat is OKX's own oddity**: the client sends the *text* `ping` (not a JSON op, not a
 * protocol-level ping frame) and the server answers with the text `pong`. OKX closes a connection
 * that has been idle for 30 s, so this goes every 25 s (§4.3). The `pong` is not a data message
 * and must not reset anything that counts as venue data — otherwise a mute-but-alive socket would
 * look healthy forever, which is exactly the failure IB-005 hit on Binance.
 */

export const PING_TEXT = 'ping';
export const PONG_TEXT = 'pong';
export const PING_INTERVAL_MS = 25_000;
export const INITIAL_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;
export const SILENCE_MS = 90_000;

export interface OkxSubscription {
  channel: string;
  instType?: string;
  instId?: string;
}

export interface OkxSocketHandlers {
  onOpen(): void;
  /** One data message: `channel` from the envelope's `arg`, `data` the array it carried. */
  onMessage(channel: string, data: unknown[], arg: { instId?: string; instType?: string }): void;
  /** The venue's own `{"event":"error"}` — a bad channel name, a bad instId. */
  onVenueError(code: string, message: string): void;
  onClose(code: number): void;
  onError(message: string): void;
}

/** The slice of `ws` used here, so a spec can hand in a fake without a server. */
export interface WebSocketLike {
  on(event: 'open' | 'message' | 'close' | 'error' | 'pong', listener: (...args: never[]) => void): unknown;
  send(data: string): void;
  close(): void;
  terminate?(): void;
}

export interface OkxSocketOptions {
  wsUrl: string;
  subscriptions: readonly OkxSubscription[];
  handlers: OkxSocketHandlers;
  factory?: (url: string) => WebSocketLike;
  now?: () => number;
  silenceMs?: number;
}

export class OkxSocket {
  private socket: WebSocketLike | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private closed = false;
  private lastMessageAt: number | null = null;
  private readonly now: () => number;
  readonly silenceMs: number;

  constructor(private readonly options: OkxSocketOptions) {
    this.now = options.now ?? Date.now;
    this.silenceMs = options.silenceMs ?? SILENCE_MS;
  }

  /** OKX takes many channels in one `subscribe`; the venue answers one `event: subscribe` each. */
  static subscribeFrame(subscriptions: readonly OkxSubscription[]): string {
    return JSON.stringify({ op: 'subscribe', args: subscriptions });
  }

  open(): void {
    this.closed = false;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const factory = this.options.factory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    const socket = factory(this.options.wsUrl);
    this.socket = socket;

    socket.on('open', (() => {
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.lastMessageAt = this.now();
      socket.send(OkxSocket.subscribeFrame(this.options.subscriptions));
      this.startPing();
      this.options.handlers.onOpen();
    }) as never);

    socket.on('message', ((raw: unknown) => this.handleMessage(String(raw))) as never);

    socket.on('close', ((code: number) => {
      this.stopPing();
      this.options.handlers.onClose(typeof code === 'number' ? code : 0);
      this.scheduleReconnect();
    }) as never);

    socket.on('error', ((err: { message?: string }) => {
      this.options.handlers.onError(err?.message ?? String(err));
    }) as never);
  }

  private handleMessage(text: string): void {
    // A pong proves the socket is alive but says nothing about the venue publishing, so it must
    // NOT reset the silence clock — otherwise a mute-but-answering socket looks healthy forever,
    // which is the exact failure IB-005 hit on Binance.
    if (text === PONG_TEXT) return;
    this.lastMessageAt = this.now();
    let message: { arg?: { channel?: string; instId?: string; instType?: string }; data?: unknown[]; event?: string; code?: string; msg?: string };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      this.options.handlers.onError(`unparseable frame: ${text.slice(0, 120)}`);
      return;
    }
    if (message.event === 'error') {
      this.options.handlers.onVenueError(message.code ?? 'unknown', message.msg ?? text.slice(0, 200));
      return;
    }
    // `event: subscribe` / `unsubscribe` are acknowledgements, not data.
    if (message.event !== undefined) return;
    if (message.arg?.channel === undefined || !Array.isArray(message.data)) return;
    this.options.handlers.onMessage(message.arg.channel, message.data, {
      instId: message.arg.instId,
      instType: message.arg.instType,
    });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try {
        this.socket?.send(PING_TEXT);
      } catch (err) {
        this.options.handlers.onError(`ping failed: ${(err as Error).message}`);
      }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.backoffTimer = setTimeout(() => this.connect(), delay);
    this.backoffTimer.unref?.();
  }

  /** Closes for good: no reconnect follows. */
  close(): void {
    this.closed = true;
    this.stopPing();
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  /**
   * The dead-socket check, driven by the caller's tick. True when it fired and the socket is being
   * replaced; the clock is reset so it does not fire again before the new socket has had its
   * window.
   */
  checkSilence(now = this.now()): boolean {
    if (this.closed || this.lastMessageAt === null) return false;
    if (now - this.lastMessageAt < this.silenceMs) return false;
    this.options.handlers.onError(`no message for ${Math.round((now - this.lastMessageAt) / 1000)} s — reconnecting`);
    this.lastMessageAt = now;
    this.reopen();
    return true;
  }

  /** Drops the current connection so the backoff re-opens it. */
  reopen(): void {
    this.socket?.terminate?.() ?? this.socket?.close();
  }
}

import WebSocket from 'ws';

/**
 * IB-008 — the Bybit v5 public socket (design §4.3).
 *
 * Deliberately **not** the Binance `PerpSocket`: the protocols differ where it matters. Bybit
 * subscribes with an `{op:'subscribe', args:[…]}` frame after the handshake, answers with an
 * `{op:'subscribe', success:…}` ack, and expects a **client-sent `{op:'ping'}` every 20 s**
 * (Binance's server pings and `ws` answers automatically). Sharing one class would mean a flag
 * for each of those; when dev-1's `binance-common` lands, the pieces that really are shared —
 * backoff, the silence watchdog — can move there.
 *
 * Dead-socket rule, as IB-005: no message for `silenceMs` (90 s) → reconnect. Bybit's WS is
 * reachable from the dev network (unlike Binance's fstream), so there is no degraded REST mode
 * here: `allLiquidation` has no REST equivalent at all, and a silent socket is a reconnect, not a
 * fallback.
 */

export interface BybitSocketHandlers {
  onOpen(): void;
  onMessage(payload: unknown): void;
  onClose(code: number): void;
  onError(message: string): void;
  /** The venue refused a subscription — a wrong or retired topic name must be loud, not silent. */
  onSubscribeFailed(message: string): void;
}

export interface WebSocketLike {
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: never[]) => void): unknown;
  send(data: string): void;
  close(): void;
  terminate?(): void;
}

export interface BybitSocketOptions {
  url: string;
  topics: readonly string[];
  handlers: BybitSocketHandlers;
  factory?: (url: string) => WebSocketLike;
  pingMs?: number;
  silenceMs?: number;
  now?: () => number;
}

export const PING_MS = 20_000;
export const SILENCE_MS = 90_000;
export const INITIAL_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;
/** Bybit caps a subscribe frame's args; chunking keeps a 30-symbol universe inside it. */
export const MAX_TOPICS_PER_FRAME = 10;

export function chunkTopics(topics: readonly string[], size = MAX_TOPICS_PER_FRAME): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < topics.length; i += size) out.push(topics.slice(i, i + size));
  return out;
}

export class BybitSocket {
  private socket: WebSocketLike | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private lastMessageAt: number | null = null;
  /** IB-122 (L5): the topics to (re)subscribe; `setTopics` changes them on a live socket without a reconnect. */
  private topics: string[];
  private subscribed = false;
  private readonly factory: (url: string) => WebSocketLike;
  private readonly now: () => number;
  readonly pingMs: number;
  readonly silenceMs: number;

  constructor(private readonly options: BybitSocketOptions) {
    this.factory = options.factory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.now = options.now ?? Date.now;
    this.pingMs = options.pingMs ?? PING_MS;
    this.silenceMs = options.silenceMs ?? SILENCE_MS;
    this.topics = [...options.topics];
  }

  /**
   * IB-122 (L5): a new topic set. On an open socket the difference is sent as `subscribe` / `unsubscribe`
   * frames — no reconnect, so nothing in flight on the other topics is lost; a closed socket takes the new
   * set on its next open.
   */
  setTopics(next: readonly string[]): { added: string[]; removed: string[] } {
    const added = next.filter((t) => !this.topics.includes(t));
    const removed = this.topics.filter((t) => !next.includes(t));
    this.topics = [...next];
    const socket = this.socket;
    if (socket && this.subscribed) {
      for (const chunk of chunkTopics(added)) socket.send(JSON.stringify({ op: 'subscribe', args: chunk }));
      for (const chunk of chunkTopics(removed)) socket.send(JSON.stringify({ op: 'unsubscribe', args: chunk }));
    }
    return { added, removed };
  }

  get currentTopics(): readonly string[] {
    return this.topics;
  }

  open(): void {
    this.stopped = false;
    this.closeSocket();
    const socket = this.factory(this.options.url);
    this.socket = socket;

    socket.on('open', (() => {
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.lastMessageAt = this.now();
      for (const chunk of chunkTopics(this.topics)) {
        socket.send(JSON.stringify({ op: 'subscribe', args: chunk }));
      }
      this.subscribed = true;
      this.startPing();
      this.options.handlers.onOpen();
    }) as never);

    socket.on('message', ((raw: unknown) => {
      this.lastMessageAt = this.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        return;
      }
      const ack = parsed as { op?: string; success?: boolean; ret_msg?: string };
      if (ack?.op === 'subscribe' && ack.success === false) {
        this.options.handlers.onSubscribeFailed(ack.ret_msg ?? 'subscribe refused');
        return;
      }
      if (ack?.op === 'ping' || ack?.op === 'pong' || ack?.op === 'subscribe' || ack?.op === 'unsubscribe') return; // acks are not data
      this.options.handlers.onMessage(parsed);
    }) as never);

    socket.on('close', ((code: number) => {
      this.socket = null;
      this.subscribed = false;
      this.stopPing();
      this.options.handlers.onClose(typeof code === 'number' ? code : 0);
      this.scheduleReconnect();
    }) as never);

    socket.on('error', ((error: Error) => {
      this.options.handlers.onError(error?.message ?? 'socket error');
    }) as never);
  }

  /** The dead-socket rule: call it on the collector's tick. Returns true when it reconnected. */
  checkSilence(now = this.now()): boolean {
    if (this.stopped || this.lastMessageAt === null) return false;
    if (now - this.lastMessageAt < this.silenceMs) return false;
    this.options.handlers.onError(`no message for ${Math.round((now - this.lastMessageAt) / 1000)} s — reconnecting`);
    this.lastMessageAt = now; // do not fire again until the new socket has had its window
    this.open();
    return true;
  }

  get lastMessage(): number | null {
    return this.lastMessageAt;
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
    this.closeSocket();
  }

  /** Bybit closes a socket that has not pinged in 30 s; 20 s keeps a margin. */
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try {
        this.socket?.send(JSON.stringify({ op: 'ping' }));
      } catch {
        // the close handler will deal with it
      }
    }, this.pingMs);
    (this.pingTimer as { unref?: () => void }).unref?.();
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open();
    }, delay);
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

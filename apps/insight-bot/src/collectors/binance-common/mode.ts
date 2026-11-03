/**
 * IB-005 — the WS ⇄ degraded decision, as a pure state machine (design §16.1, ruling 2026-09-28).
 *
 * Why it exists: a socket can complete the handshake and then send nothing. The IB-013 probe saw
 * exactly that from `fstream.binance.com` and read it as a network block; IB-BUG-012 found the real
 * cause — the legacy `/stream` path, which since 2026-04-23 carries only Binance's `/public` streams
 * (the perp collector now connects to `/market`, `binance-perp/streams.ts`). The lesson stands: a
 * socket that is open but mute is not a socket failure — nothing throws, nothing closes — so the
 * collector times it instead:
 *
 * - **open but no data within `silentAfterOpenMs` (30 s)** → degraded;
 * - **no data for `silenceMs` (90 s)** once it had been flowing → degraded (this is the case
 *   signal-server's own fallback does not cover, §16.2);
 * - in degraded mode the socket is retried every `retryMs` (5 min); the first message returns the
 *   collector to WS.
 *
 * Feeding it only timestamps keeps it testable without timers: every transition below is a spec.
 */

export type CollectorMode = 'ws' | 'degraded';

export interface ModePolicyOptions {
  /** A freshly opened socket must produce data within this long. */
  silentAfterOpenMs?: number;
  /** A flowing socket that stops for this long is dead. */
  silenceMs?: number;
  /** How often degraded mode re-opens the socket to test it. */
  retryMs?: number;
}

export const DEFAULT_MODE_POLICY = {
  silentAfterOpenMs: 30_000,
  silenceMs: 90_000,
  retryMs: 300_000,
} as const;

export type ModeEvent =
  | { kind: 'reconnect' } // open the socket (first time, or the degraded retry)
  | { kind: 'degrade'; reason: 'silent-after-open' | 'silence' }
  | { kind: 'recover' }; // a message arrived while degraded

/**
 * Holds when the socket was opened, when data last arrived and which mode we are in; `tick(now)`
 * returns the transition to act on, if any. The caller performs the I/O and reports back through
 * `onOpen` / `onMessage`.
 */
export class ModePolicy {
  readonly silentAfterOpenMs: number;
  readonly silenceMs: number;
  readonly retryMs: number;

  private state: CollectorMode = 'ws';
  private openedAt: number | null = null;
  /** A connect attempt is in flight (the handshake takes seconds); set when we ask for a socket. */
  private connectingSince: number | null = null;
  private lastMessageAt: number | null = null;
  private lastRetryAt: number | null = null;
  private lastReason: 'silent-after-open' | 'silence' | null = null;

  constructor(options: ModePolicyOptions = {}) {
    this.silentAfterOpenMs = options.silentAfterOpenMs ?? DEFAULT_MODE_POLICY.silentAfterOpenMs;
    this.silenceMs = options.silenceMs ?? DEFAULT_MODE_POLICY.silenceMs;
    this.retryMs = options.retryMs ?? DEFAULT_MODE_POLICY.retryMs;
  }

  get mode(): CollectorMode {
    return this.state;
  }

  /** Why we are degraded, for /health; null in ws mode. */
  get reason(): 'silent-after-open' | 'silence' | null {
    return this.state === 'degraded' ? this.lastReason : null;
  }

  get lastMessage(): number | null {
    return this.lastMessageAt;
  }

  /**
   * A connect attempt has been started outside `tick` (the boot path). Without this the next tick
   * would ask for a second socket while the first handshake is still in flight.
   */
  onConnecting(now: number): void {
    if (this.openedAt === null && this.connectingSince === null) this.connectingSince = now;
  }

  /** The socket has just been opened (or re-opened). */
  onOpen(now: number): void {
    this.openedAt = now;
    this.connectingSince = null;
    this.lastRetryAt = now;
  }

  /** Any message on the socket. Returns the recovery transition when it ends a degraded spell. */
  onMessage(now: number): ModeEvent | null {
    this.lastMessageAt = now;
    if (this.state !== 'degraded') return null;
    this.state = 'ws';
    this.lastReason = null;
    return { kind: 'recover' };
  }

  /**
   * The socket closed. `BinanceSocket` reconnects itself with backoff, so the policy does NOT ask for
   * another socket here — it only starts counting: if no data arrives within `silentAfterOpenMs`
   * we degrade. (Found by the first live run: asking again on every tick opened a socket per
   * second while the handshake was still in flight — "closed before the connection was
   * established", 39 reconnects in 40 s.)
   */
  onClosed(now?: number): void {
    this.openedAt = null;
    this.connectingSince = now ?? this.connectingSince ?? null;
  }

  /**
   * The one place the clock enters. Returns at most one transition per call, in priority order:
   * degrade on mute, retry the socket while degraded, re-open a closed socket.
   */
  tick(now: number): ModeEvent | null {
    if (this.state === 'ws') {
      if (this.openedAt === null) {
        // no socket yet: ask for one, once, then wait for it to open or time out
        if (this.connectingSince === null) {
          this.connectingSince = now;
          return { kind: 'reconnect' };
        }
        return now - this.connectingSince >= this.silentAfterOpenMs ? this.degrade('silent-after-open') : null;
      }
      const flowing = this.lastMessageAt !== null && this.lastMessageAt >= this.openedAt;
      if (!flowing && now - this.openedAt >= this.silentAfterOpenMs) return this.degrade('silent-after-open');
      if (flowing && now - (this.lastMessageAt as number) >= this.silenceMs) return this.degrade('silence');
      return null;
    }
    // degraded: retry the socket on a slow cadence; recovery happens in onMessage
    if (this.lastRetryAt === null || now - this.lastRetryAt >= this.retryMs) {
      this.lastRetryAt = now;
      return { kind: 'reconnect' };
    }
    return null;
  }

  private degrade(reason: 'silent-after-open' | 'silence'): ModeEvent {
    this.state = 'degraded';
    this.lastReason = reason;
    this.openedAt = null;
    this.connectingSince = null;
    return { kind: 'degrade', reason };
  }
}


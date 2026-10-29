import { BehaviorSubject, Observable } from 'rxjs';
import WebSocket from 'ws';
import { Candle, Instrument, TIMEFRAME_MS, Timeframe, VenueStatus } from '@trade-automation/contracts';
import { BinanceRestKline, BinanceWsKlineMessage, mapRestKline, mapWsKline } from './binance.mapper';

/**
 * Where this client's warnings go (IB-001): signal-server passes its Nest `Logger`, which has these
 * two methods; a caller that passes nothing gets the console.
 */
export interface BinanceClientLogger {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * BUG-019: how long the live socket may stay quiet before it counts as mute. Binance's USD-M
 * `fstream` has been observed accepting the handshake and then sending nothing — sometimes from the
 * first byte, sometimes after hours of normal traffic — without ever emitting `close`. A socket like
 * that used to strand the feed forever (the old fallback armed only if the socket had NEVER spoken,
 * and a reconnect needed a `close` event), which is how the coordinator's candles went ~25 h stale.
 */
export interface BinanceStreamTimings {
  /** No message this long after the socket opens → mute. */
  silenceAfterOpenMs: number;
  /** No message for this long once it has delivered at least one → mute. */
  silenceMs: number;
  /** While mute: how long to wait before trying the socket again. */
  muteRetryMs: number;
  /** REST poll interval while the socket is mute. */
  restPollMs: number;
}

export const DEFAULT_STREAM_TIMINGS: BinanceStreamTimings = {
  silenceAfterOpenMs: 30_000,
  silenceMs: 90_000,
  muteRetryMs: 300_000,
  restPollMs: 3_000,
};

const CONSOLE_LOGGER: BinanceClientLogger = {
  // eslint-disable-next-line no-console
  log: (message) => console.log(message),
  // eslint-disable-next-line no-console
  warn: (message) => console.warn(message),
};

/**
 * A Binance combined-stream message: `{"stream":"btcusdt@kline_1m","data":{…}}`. The `/stream?streams=…`
 * URL form wraps every payload this way, including a socket that carries one stream.
 */
interface BinanceCombinedMessage {
  stream?: string;
  data?: unknown;
}

// Binance futures kline REST page size — fapi/v1/klines `limit` max, per venue docs
// (https://binance-docs.github.io/apidocs/futures/en/#kline-candlestick-data), mirrored from
// cmc-bot-main's BinanceClient which requests the same endpoint.
export const REST_PAGE_LIMIT = 1500;

/**
 * IB-063: a klines request the venue answered with an error status. The message is the one this
 * adapter always threw; `status` and Binance's own `code` (e.g. -1121 "Invalid symbol") are there
 * so a caller can tell "this symbol does not exist" from "the venue is down" from "we are banned".
 */
export class BinanceHttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    readonly venueCode: number | null,
  ) {
    super(`Binance klines request failed: ${status} ${statusText}`);
    this.name = 'BinanceHttpError';
  }
}

/** IB-063: what an on-demand caller adds to `fetchCandles`; every field is optional. */
export interface FetchCandlesOptions {
  /** Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Passed to every page request, e.g. `AbortSignal.timeout(…)`. */
  signal?: AbortSignal;
  /** Called once per answered page request, before its status is checked: weight accounting. */
  onResponse?: (response: Response) => void;
}

export class BinanceAdapter {
  readonly venue = 'binance' as const;

  constructor(
    private readonly restBaseUrl: string,
    private readonly wsBaseUrl: string,
    private readonly logger: BinanceClientLogger = CONSOLE_LOGGER,
    private readonly timings: BinanceStreamTimings = DEFAULT_STREAM_TIMINGS,
  ) {}

  /**
   * BUG-019: 'degraded' while any stream of this adapter is mute and served from REST, 'up' once the
   * socket delivers again. `health()` replays the current value, so signal-server's per-instrument
   * status (and `GET /api/health`) shows the degraded mode instead of a permanent 'up'.
   */
  private readonly status = new BehaviorSubject<VenueStatus>('up');
  private muteStreams = 0;

  /**
   * §12.5 item 3: `interval` is set to whatever `tf` is requested (Binance's kline interval
   * strings are identical to this system's `Timeframe` literals for every value we use —
   * `1m`/`5m`/`15m`/`1h`/`4h`/`1d`), same pagination shape as the original 1m-only path, just
   * walking `REST_PAGE_LIMIT` bars of `tf` at a time instead of always 1m.
   */
  async fetchCandles(
    instrument: Pick<Instrument, 'id' | 'symbol'>,
    tf: Timeframe,
    from: number,
    to: number,
    options: FetchCandlesOptions = {},
  ): Promise<Candle[]> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const out: Candle[] = [];
    const tfMs = TIMEFRAME_MS[tf];
    let cursor = from;

    while (cursor <= to) {
      const url = new URL('/fapi/v1/klines', this.restBaseUrl);
      url.searchParams.set('symbol', instrument.symbol);
      url.searchParams.set('interval', tf);
      url.searchParams.set('startTime', String(cursor));
      url.searchParams.set('endTime', String(to));
      url.searchParams.set('limit', String(REST_PAGE_LIMIT));

      const res = await fetchImpl(url, options.signal ? { signal: options.signal } : undefined);
      options.onResponse?.(res);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
        throw new BinanceHttpError(res.status, res.statusText, typeof body?.code === 'number' ? body.code : null);
      }
      const rows = (await res.json()) as BinanceRestKline[];
      if (rows.length === 0) break;

      out.push(...rows.map((row) => mapRestKline(instrument.id, row, tf)));
      const lastOpenTime = rows[rows.length - 1][0];
      if (rows.length < REST_PAGE_LIMIT || lastOpenTime >= to) break;
      cursor = lastOpenTime + tfMs;
    }

    return out;
  }

  /**
   * REST poll of the last two 1m klines, used when the WebSocket is reachable but silent.
   *
   * Emits the same shape the WS path emits: the newest row is the in-progress candle
   * (`closed: false`, re-emitted on every poll exactly as the stream re-sends it), the row
   * before it is the completed candle, emitted once per `openTime`.
   *
   * Cost: `limit=2` is weight 1 (measured against `x-mbx-used-weight-1m` on 2026-09-17, three
   * consecutive calls incremented it by exactly 1 each). At POLL_MS = 3000 and two configured
   * Binance instruments that is 40 weight/minute against the venue's published 2400/minute
   * REQUEST_WEIGHT budget — under 2 %, leaving the backfill and gap-repair paths their room.
   */
  private streamCandlesViaRest(instrument: Instrument): Observable<Candle> {
    const POLL_MS = this.timings.restPollMs;
    const url =
      `${this.restBaseUrl}/fapi/v1/klines` +
      `?symbol=${instrument.symbol}&interval=1m&limit=2`;

    return new Observable<Candle>((subscriber) => {
      let stopped = false;
      let lastClosedOpenTime = -1;
      let timer: NodeJS.Timeout | null = null;

      const poll = async () => {
        if (stopped) return;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const rows = (await res.json()) as BinanceRestKline[];
          if (rows.length >= 2) {
            const closedRow = mapRestKline(instrument.id, rows[rows.length - 2], '1m');
            if (closedRow.openTime > lastClosedOpenTime) {
              lastClosedOpenTime = closedRow.openTime;
              subscriber.next({ ...closedRow, source: 'venue-rest' });
            }
          }
          const live = rows[rows.length - 1];
          if (live) {
            subscriber.next({ ...mapRestKline(instrument.id, live, '1m'), closed: false, source: 'venue-rest' });
          }
        } catch (err) {
          this.logger.warn(
            `Binance REST candle poll failed for ${instrument.symbol}: ${(err as Error).message}`,
          );
        } finally {
          if (!stopped) timer = setTimeout(poll, POLL_MS);
        }
      };

      void poll();

      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    });
  }

  streamCandles(instrument: Instrument): Observable<Candle> {
    return this.streamKlines([`${instrument.symbol.toLowerCase()}@kline_1m`], instrument);
  }

  /**
   * One socket for `streams` on the combined-stream URL (`/stream?streams=a/b/c`), so a later caller
   * can multiplex many symbols on one connection (IB-001); Binance wraps every payload as
   * `{stream, data}` there, which `onMessage` unwraps, so a single-stream caller sees exactly what
   * the old `/ws/<stream>` path gave it. Backoff, the silent-socket REST fallback and the parse
   * guard below are unchanged.
   */
  streamKlines(streams: readonly string[], instrument: Instrument): Observable<Candle> {
    const url = `${this.wsBaseUrl}/stream?streams=${streams.join('/')}`;
    const { silenceAfterOpenMs, silenceMs, muteRetryMs } = this.timings;

    return new Observable<Candle>((subscriber) => {
      let ws: WebSocket | null = null;
      let stopped = false;
      let backoffMs = 1000;
      const MAX_BACKOFF_MS = 30_000;

      // BUG-019: the watchdog. Every message re-arms it; when it fires, the socket is mute — the
      // feed falls back to REST polling (so candles keep coming) AND the socket is reconnected,
      // retried every `muteRetryMs` while it stays mute. The first message on a reconnected socket
      // stops the polling and logs the recovery: the fallback is no longer one-way for the life of
      // the subscription, which is what left a silent-after-open socket stranded.
      let silenceTimer: NodeJS.Timeout | null = null;
      let reconnectTimer: NodeJS.Timeout | null = null;
      let restSub: { unsubscribe(): void } | null = null;
      let mute = false;

      const clearSilence = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = null;
      };

      const armSilence = (ms: number) => {
        clearSilence();
        silenceTimer = setTimeout(onSilence, ms);
      };

      const startRestFallback = () => {
        if (stopped || restSub) return;
        this.logger.warn(
          `Binance WS for ${instrument.symbol} is mute — polling REST every ${this.timings.restPollMs}ms ` +
            `and retrying the socket every ${muteRetryMs}ms`,
        );
        this.degrade();
        restSub = this.streamCandlesViaRest(instrument).subscribe({
          next: (c) => subscriber.next(c),
          error: (e) => subscriber.error(e),
        });
      };

      const stopRestFallback = () => {
        if (!restSub) return;
        restSub.unsubscribe();
        restSub = null;
        this.recover();
        this.logger.log(`Binance WS for ${instrument.symbol} is delivering again — back on the stream`);
      };

      const onSilence = () => {
        if (stopped) return;
        silenceTimer = null;
        mute = true;
        startRestFallback();
        // force the reconnect the venue never asks for: a mute socket emits no `close` of its own
        const socket = ws;
        ws = null;
        socket?.removeAllListeners?.();
        socket?.close();
        scheduleConnect(muteRetryMs);
      };

      const scheduleConnect = (ms: number) => {
        if (stopped || reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, ms);
      };

      const connect = () => {
        if (stopped) return;
        ws = new WebSocket(url);

        ws.on('open', () => {
          backoffMs = 1000;
          armSilence(silenceAfterOpenMs);
        });

        ws.on('message', (data: WebSocket.RawData) => {
          armSilence(silenceMs);
          if (mute) {
            mute = false;
            stopRestFallback();
          }
          try {
            const raw = JSON.parse(data.toString()) as BinanceCombinedMessage | BinanceWsKlineMessage;
            const msg = ('stream' in raw && raw.data !== undefined ? raw.data : raw) as BinanceWsKlineMessage;
            if (msg.e === 'kline') {
              subscriber.next(mapWsKline(instrument.id, msg));
            }
          } catch (err) {
            this.logger.warn(`Failed to parse Binance kline message: ${(err as Error).message}`);
          }
        });

        ws.on('error', (err: Error) => {
          this.logger.warn(`Binance WS error for ${instrument.symbol}: ${err.message}`);
        });

        ws.on('close', () => {
          if (stopped) return;
          clearSilence();
          this.logger.warn(
            `Binance WS closed for ${instrument.symbol}; reconnecting in ${backoffMs}ms ` +
              '(gap, if any, will be closed by GapRepair on the next closed candle)',
          );
          scheduleConnect(backoffMs);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        });
      };

      connect();

      return () => {
        stopped = true;
        clearSilence();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (restSub) {
          restSub.unsubscribe();
          restSub = null;
          this.recover();
        }
        ws?.close();
      };
    });
  }

  /** One more stream of this adapter is mute: the venue is degraded until every one recovers. */
  private degrade(): void {
    this.muteStreams += 1;
    if (this.muteStreams === 1) this.status.next('degraded');
  }

  private recover(): void {
    this.muteStreams = Math.max(0, this.muteStreams - 1);
    if (this.muteStreams === 0) this.status.next('up');
  }

  /** BUG-019: the live venue status — 'degraded' while a mute socket is served from REST. */
  health(): Observable<VenueStatus> {
    return this.status.asObservable();
  }
}

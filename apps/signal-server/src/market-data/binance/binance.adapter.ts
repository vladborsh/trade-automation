import { Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import WebSocket from 'ws';
import { Candle, Instrument, TIMEFRAME_MS, Timeframe, VenueStatus } from '@trade-automation/contracts';
import { VenueAdapter } from '../venue-adapter.port';
import { BinanceRestKline, BinanceWsKlineMessage, mapRestKline, mapWsKline } from './binance.mapper';

// Binance futures kline REST page size — fapi/v1/klines `limit` max, per venue docs
// (https://binance-docs.github.io/apidocs/futures/en/#kline-candlestick-data), mirrored from
// cmc-bot-main's BinanceClient which requests the same endpoint.
const REST_PAGE_LIMIT = 1500;

export class BinanceAdapter implements VenueAdapter {
  readonly venue = 'binance' as const;
  private readonly logger = new Logger(BinanceAdapter.name);

  constructor(
    private readonly restBaseUrl: string,
    private readonly wsBaseUrl: string,
  ) {}

  /**
   * §12.5 item 3: `interval` is set to whatever `tf` is requested (Binance's kline interval
   * strings are identical to this system's `Timeframe` literals for every value we use —
   * `1m`/`5m`/`15m`/`1h`/`4h`/`1d`), same pagination shape as the original 1m-only path, just
   * walking `REST_PAGE_LIMIT` bars of `tf` at a time instead of always 1m.
   */
  async fetchCandles(instrument: Instrument, tf: Timeframe, from: number, to: number): Promise<Candle[]> {
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

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Binance klines request failed: ${res.status} ${res.statusText}`);
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
    const POLL_MS = 3000;
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
    const stream = `${instrument.symbol.toLowerCase()}@kline_1m`;
    const url = `${this.wsBaseUrl}/ws/${stream}`;

    return new Observable<Candle>((subscriber) => {
      let ws: WebSocket | null = null;
      let stopped = false;
      let backoffMs = 1000;
      const MAX_BACKOFF_MS = 30_000;

      // `fstream.binance.com` was observed (2026-09-17) accepting the TLS/WS handshake and then
      // sending NOTHING — verified outside this codebase, and against @aggTrade (a
      // many-per-second stream) as well as @kline_1m, while spot, COIN-M `dstream` and the
      // `data-stream.binance.vision` mirror all delivered normally from the same host. That is a
      // silent venue/region block, not a bug here, and a socket that is open but mute would
      // otherwise strand the feed forever with no error to reconnect on. So: if the socket
      // produces no message within SILENT_WS_TIMEOUT_MS of opening, fall back to REST polling.
      // The fallback is one-way for the life of the subscription; a restart re-tries the WS, so
      // the real stream comes back on its own if the block lifts or a VPN is used.
      const SILENT_WS_TIMEOUT_MS = 30_000;
      let sawMessage = false;
      let silenceTimer: NodeJS.Timeout | null = null;
      let restSub: { unsubscribe(): void } | null = null;

      const fallBackToRest = () => {
        if (stopped || restSub) return;
        this.logger.warn(
          `Binance WS for ${instrument.symbol} opened but sent nothing in ${SILENT_WS_TIMEOUT_MS}ms ` +
            '— falling back to REST polling for this subscription (restart to re-try the stream)',
        );
        stopped = true;
        ws?.close();
        restSub = this.streamCandlesViaRest(instrument).subscribe({
          next: (c) => subscriber.next(c),
          error: (e) => subscriber.error(e),
        });
      };

      const connect = () => {
        if (stopped) return;
        ws = new WebSocket(url);

        ws.on('open', () => {
          backoffMs = 1000;
          if (!sawMessage && !silenceTimer) {
            silenceTimer = setTimeout(fallBackToRest, SILENT_WS_TIMEOUT_MS);
          }
        });

        ws.on('message', (data: WebSocket.RawData) => {
          if (!sawMessage) {
            sawMessage = true;
            if (silenceTimer) {
              clearTimeout(silenceTimer);
              silenceTimer = null;
            }
          }
          try {
            const msg = JSON.parse(data.toString()) as BinanceWsKlineMessage;
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
          this.logger.warn(
            `Binance WS closed for ${instrument.symbol}; reconnecting in ${backoffMs}ms ` +
              '(gap, if any, will be closed by GapRepair on the next closed candle)',
          );
          setTimeout(connect, backoffMs);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        });
      };

      connect();

      return () => {
        stopped = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        restSub?.unsubscribe();
        ws?.close();
      };
    });
  }

  health(): Observable<VenueStatus> {
    return new Observable<VenueStatus>((subscriber) => {
      subscriber.next('up');
    });
  }
}

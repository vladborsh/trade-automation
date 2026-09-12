import { Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import WebSocket from 'ws';
import { Candle, Instrument, Timeframe, VenueStatus } from '@trade-automation/contracts';
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

  async fetchCandles(instrument: Instrument, tf: Timeframe, from: number, to: number): Promise<Candle[]> {
    if (tf !== '1m') {
      throw new Error('BinanceAdapter.fetchCandles only supports 1m; coarser bars are resampled');
    }
    const out: Candle[] = [];
    let cursor = from;

    while (cursor <= to) {
      const url = new URL('/fapi/v1/klines', this.restBaseUrl);
      url.searchParams.set('symbol', instrument.symbol);
      url.searchParams.set('interval', '1m');
      url.searchParams.set('startTime', String(cursor));
      url.searchParams.set('endTime', String(to));
      url.searchParams.set('limit', String(REST_PAGE_LIMIT));

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Binance klines request failed: ${res.status} ${res.statusText}`);
      }
      const rows = (await res.json()) as BinanceRestKline[];
      if (rows.length === 0) break;

      out.push(...rows.map((row) => mapRestKline(instrument.id, row)));
      const lastOpenTime = rows[rows.length - 1][0];
      if (rows.length < REST_PAGE_LIMIT || lastOpenTime >= to) break;
      cursor = lastOpenTime + 60_000;
    }

    return out;
  }

  streamCandles(instrument: Instrument): Observable<Candle> {
    const stream = `${instrument.symbol.toLowerCase()}@kline_1m`;
    const url = `${this.wsBaseUrl}/ws/${stream}`;

    return new Observable<Candle>((subscriber) => {
      let ws: WebSocket | null = null;
      let stopped = false;
      let backoffMs = 1000;
      const MAX_BACKOFF_MS = 30_000;

      const connect = () => {
        if (stopped) return;
        ws = new WebSocket(url);

        ws.on('open', () => {
          backoffMs = 1000;
        });

        ws.on('message', (data: WebSocket.RawData) => {
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

import { Candle, InstrumentId } from '@trade-automation/contracts';

/** One row of Binance's `GET /fapi/v1/klines` REST response (array-of-arrays). */
export type BinanceRestKline = [
  number, // 0 open time
  string, // 1 open
  string, // 2 high
  string, // 3 low
  string, // 4 close
  string, // 5 volume
  number, // 6 close time
  string, // 7 quote asset volume
  number, // 8 number of trades
  string, // 9 taker buy base asset volume
  string, // 10 taker buy quote asset volume
  string, // 11 ignore
];

/** The `k` object of a Binance `<symbol>@kline_1m` WebSocket message. */
export interface BinanceWsKline {
  t: number; // kline start time — the field this scaffold uses for openTime, never Date.now()
  T: number; // kline close time
  s: string;
  i: string;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  x: boolean; // is this kline closed
}

export interface BinanceWsKlineMessage {
  e: 'kline';
  E: number;
  s: string;
  k: BinanceWsKline;
}

/**
 * architecture/live-signal-server.md §1, §4.1: cmc-bot-main's `BinanceClient.mapCandle` set
 * `openTime: Date.now() - interval` instead of the exchange's kline start time — fine for a
 * Telegram alert bot, wrong for a server whose candles back-fill storage and are joined to
 * signals by timestamp. Every mapper below takes `openTime` from the venue payload only.
 */
export function mapRestKline(instrument: InstrumentId, kline: BinanceRestKline): Candle {
  const [openTime, open, high, low, close, volume] = kline;
  return {
    instrument,
    timeframe: '1m',
    openTime,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    closed: true,
    source: 'venue-rest',
  };
}

export function mapWsKline(instrument: InstrumentId, msg: BinanceWsKlineMessage): Candle {
  const k = msg.k;
  return {
    instrument,
    timeframe: '1m',
    openTime: k.t,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    closed: k.x,
    source: 'venue-stream',
  };
}

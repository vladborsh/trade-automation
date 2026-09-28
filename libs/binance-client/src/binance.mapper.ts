import { Candle, InstrumentId, Timeframe } from '@trade-automation/contracts';

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
  // IB-002: present on both futures and spot kline streams; optional here so a caller's older
  // fixture (signal-server's specs) still type-checks and simply yields no activity fields.
  q?: string; // quote asset volume
  n?: number; // number of trades
  V?: string; // taker buy base asset volume
  Q?: string; // taker buy quote asset volume
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
 *
 * `tf` defaults to `'1m'` (the only timeframe fetched before §12) with `source: 'venue-rest'`;
 * §12.1/§12.5 item 3's native coarser fetch (`5m`/`15m`/`1h`/`4h`/`1d`) passes the requested `tf`
 * and gets `source: 'venue-native'` instead, so the cache's overlap-window priority rule can
 * tell a native pull apart from the 1m-resampled series it is a depth extension behind.
 *
 * IB-002: both mappers also carry the venue's activity fields (quote volume, trades, taker-buy
 * base and quote) when the payload has them — REST columns 7–10, WS `q`/`n`/`V`/`Q`. The shapes are
 * identical on USD-M futures and spot, so one pair of mappers serves both (design §2.2, §4.2). A
 * field the payload omits is left out entirely rather than written as 0: zero volume is a fact,
 * "not reported" is not.
 */

/** The four optional activity fields of a Candle, from raw strings/numbers; omits what is absent. */
function activity(quote?: string, trades?: number, takerBase?: string, takerQuote?: string) {
  return {
    ...(quote === undefined ? {} : { quoteVolume: Number(quote) }),
    ...(trades === undefined ? {} : { trades }),
    ...(takerBase === undefined ? {} : { takerBuyVolume: Number(takerBase) }),
    ...(takerQuote === undefined ? {} : { takerBuyQuoteVolume: Number(takerQuote) }),
  };
}
export function mapRestKline(instrument: InstrumentId, kline: BinanceRestKline, tf: Timeframe = '1m'): Candle {
  const [openTime, open, high, low, close, volume, , quoteVolume, trades, takerBuyVolume, takerBuyQuoteVolume] = kline;
  return {
    instrument,
    timeframe: tf,
    openTime,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    closed: true,
    source: tf === '1m' ? 'venue-rest' : 'venue-native',
    ...activity(quoteVolume, trades, takerBuyVolume, takerBuyQuoteVolume),
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
    ...activity(k.q, k.n, k.V, k.Q),
  };
}

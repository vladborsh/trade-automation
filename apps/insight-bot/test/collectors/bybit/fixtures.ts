/**
 * IB-008 — payloads recorded from `wss://stream.bybit.com/v5/public/linear` on 2026-09-28, trimmed
 * of the order-book fields this collector ignores. The shapes, field names and string numbers are
 * the venue's own: a spec that invents them proves nothing.
 */

export const TICKER_SNAPSHOT = {
  "topic": "tickers.BTCUSDT",
  "type": "snapshot",
  "data": {
    "symbol": "BTCUSDT",
    "tickDirection": "ZeroPlusTick",
    "price24hPcnt": "-0.017335",
    "lastPrice": "82997.50",
    "prevPrice24h": "84461.70",
    "highPrice24h": "84974.90",
    "lowPrice24h": "82468.00",
    "prevPrice1h": "83450.00",
    "markPrice": "82997.40",
    "indexPrice": "83033.00",
    "openInterest": "56859.976",
    "openInterestValue": "4719230172.06",
    "turnover24h": "4434628865.2619",
    "volume24h": "53103.5540",
    "fundingIntervalHour": "8",
    "fundingCap": "0.00333",
    "singleOpenInterest": "28429.988",
    "singleOpenInterestValue": "2359615086.03",
    "nextFundingTime": "1790611200000",
    "fundingRate": "0.00005416",
    "bid1Price": "82997.40",
    "bid1Size": "2.933",
    "ask1Price": "82997.50",
    "ask1Size": "3.579",
    "preOpenPrice": "",
    "preQty": "",
    "curPreListingPhase": ""
  },
  "ts": 1790608118283
} as const;

/** The very next message on the same topic: a DELTA, with no markPrice and no fundingRate. */
export const TICKER_DELTA = {
  "topic": "tickers.BTCUSDT",
  "type": "delta",
  "data": {
    "symbol": "BTCUSDT",
    "indexPrice": "83032.80",
    "bid1Price": "82997.40",
    "bid1Size": "2.085"
  },
  "ts": 1790608118384
} as const;

/** `allLiquidation.ETHUSDT`, three consecutive pushes (the topic fires every 500 ms). */
export const LIQUIDATIONS = [
  {
    "topic": "allLiquidation.ETHUSDT",
    "type": "snapshot",
    "ts": 1790608175872,
    "data": [
      {
        "T": 1790608175868,
        "s": "ETHUSDT",
        "S": "Sell",
        "v": "0.08",
        "p": "2679.27"
      }
    ]
  },
  {
    "topic": "allLiquidation.ETHUSDT",
    "type": "snapshot",
    "ts": 1790608180372,
    "data": [
      {
        "T": 1790608180149,
        "s": "ETHUSDT",
        "S": "Sell",
        "v": "0.03",
        "p": "2680.75"
      }
    ]
  },
  {
    "topic": "allLiquidation.BTCUSDT",
    "type": "snapshot",
    "ts": 1790608180482,
    "data": [
      {
        "T": 1790608180255,
        "s": "BTCUSDT",
        "S": "Sell",
        "v": "0.001",
        "p": "83373.60"
      }
    ]
  }
] as const;

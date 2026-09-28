/**
 * IB-008 — Bybit v5 public payload shapes, checked against the live venue and the docs on
 * 2026-09-28 (design §4.3).
 *
 * Two facts that decide the design, both confirmed by probing `wss://stream.bybit.com/v5/public/linear`:
 *
 * 1. **The topic is `allLiquidation.{symbol}`.** Subscribing to the old `liquidation.{symbol}`
 *    is refused by the venue today:
 *      `{"success":false,"ret_msg":"error:handler not found,topic:liquidation.BTCUSDT","op":"subscribe"}`
 *    while `allLiquidation.BTCUSDT` answers `{"success":true,...}`.
 * 2. **`tickers` is a snapshot-then-delta topic.** The first message carries every field; the ones
 *    after it carry **only what changed** — e.g. `{"type":"delta","data":{"symbol":"BTCUSDT",
 *    "indexPrice":"83032.80","bid1Price":"82997.40","bid1Size":"2.085"}}` with no `markPrice` and
 *    no `fundingRate` at all. Reading a mark price straight off a message would therefore write
 *    nulls most of the time; `TickerState` merges deltas onto the last snapshot instead.
 */

/** Envelope of every data message: `{ topic, type, ts, data }`. */
export interface BybitMessage<T> {
  topic: string;
  type: 'snapshot' | 'delta';
  ts: number;
  data: T;
  cs?: number;
}

/** `tickers.{symbol}` — a snapshot has all of these; a delta has `symbol` plus whatever changed. */
export interface BybitTickerData {
  symbol: string;
  markPrice?: string;
  indexPrice?: string;
  lastPrice?: string;
  fundingRate?: string; // the predicted rate for the interval now running
  nextFundingTime?: string; // epoch ms, as a string
  openInterest?: string;
  openInterestValue?: string;
  [field: string]: string | undefined;
}

/**
 * `allLiquidation.{symbol}` — an array of events, pushed every 500 ms.
 *
 * Bybit's doc for this topic, quoted verbatim (read 2026-09-28):
 *   "S string Position side. Buy, Sell. **When you receive a Buy update, this means that a long
 *    position has been liquidated**"
 *
 * That is the **opposite** of Binance's `!forceOrder`, where `S = SELL` is a long being liquidated
 * (there `S` is the side of the order the engine submits). Both mappers normalise to §3.3's
 * "the side liquidated", so the two venues' rows mean the same thing — see the spec that pins it.
 */
export interface BybitLiquidationEvent {
  T: number; // event time (ms)
  s: string; // symbol
  S: 'Buy' | 'Sell'; // see the quote above
  v: string; // executed size
  p: string; // bankruptcy price
}

/** `GET /v5/market/funding/history` row. */
export interface BybitFundingHistoryRow {
  symbol: string;
  fundingRate: string;
  fundingRateTimestamp: string; // epoch ms, as a string
}

/** Any `{op: …}` acknowledgement: subscribe, ping/pong, auth. */
export interface BybitOpAck {
  op: string;
  success?: boolean;
  ret_msg?: string;
  conn_id?: string;
}

export function isTickerMessage(value: unknown): value is BybitMessage<BybitTickerData> {
  const m = value as BybitMessage<BybitTickerData>;
  return typeof m?.topic === 'string' && m.topic.startsWith('tickers.') && m.data !== undefined;
}

export function isLiquidationMessage(value: unknown): value is BybitMessage<BybitLiquidationEvent[]> {
  const m = value as BybitMessage<BybitLiquidationEvent[]>;
  return typeof m?.topic === 'string' && m.topic.startsWith('allLiquidation.') && Array.isArray(m.data);
}

export function isOpAck(value: unknown): value is BybitOpAck {
  return typeof (value as BybitOpAck)?.op === 'string';
}

/** The topics this collector subscribes for one symbol (§4.3). */
export function bybitTopics(symbol: string): string[] {
  return [`tickers.${symbol}`, `allLiquidation.${symbol}`];
}

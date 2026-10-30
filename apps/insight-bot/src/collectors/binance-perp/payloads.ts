/**
 * IB-005 — the Binance USD-M payload shapes this collector consumes, written down so the mappers
 * are typed against the venue's documented fields rather than `any`.
 *
 * Sources (Binance USD-M futures API docs, read 2026-09-28):
 * - `!markPrice@arr@1s`  → an array of `markPriceUpdate` events, one per symbol.
 * - `!forceOrder@arr`    → one `forceOrder` event per liquidation; `o.S` is the order side the
 *                          ENGINE submits, so `SELL` means a LONG was liquidated (§3.3).
 * - `GET /fapi/v1/premiumIndex` (no symbol) → the same mark/funding facts for every symbol, the
 *                          REST stand-in used in degraded mode (§16.1).
 * - `GET /fapi/v1/fundingRate?symbol=&limit=1` → the settled rate, after `nextFundingTime` rolls.
 *
 * Every numeric field arrives as a string; the mappers do the one conversion.
 */

/** One element of `!markPrice@arr@1s`. */
export interface MarkPriceEvent {
  e: 'markPriceUpdate';
  E: number; // event time
  s: string; // symbol
  p: string; // mark price
  i?: string; // index price (absent on some non-index symbols)
  P?: string; // estimated settle price, only useful in the last hour before settlement
  r: string; // predicted (current) funding rate
  T: number; // next funding time
}

/** One `!forceOrder@arr` event. */
export interface ForceOrderEvent {
  e: 'forceOrder';
  E: number;
  o: {
    s: string; // symbol
    S: 'BUY' | 'SELL'; // the side of the liquidating order, NOT the side liquidated
    o: string; // order type
    f: string; // time in force
    q: string; // original quantity
    p: string; // price
    ap: string; // average price
    X: string; // order status, e.g. FILLED
    l: string; // last filled quantity
    z: string; // filled accumulated quantity
    T: number; // trade time
    // Present on every live event captured 2026-10-29 (fixture `forceOrder-arr.json`), unused here:
    ps?: string; // pair, equal to `s` on every captured event
    st?: number; // not in the documented payload; 1 on every captured event
  };
}

/** One element of `GET /fapi/v1/premiumIndex` with no symbol. */
export interface PremiumIndexRow {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice?: string;
  lastFundingRate: string; // the predicted rate for the current interval
  interestRate?: string;
  nextFundingTime: number;
  time: number;
}

/** One element of `GET /fapi/v1/fundingRate`. */
export interface FundingRateRow {
  symbol: string;
  fundingTime: number;
  fundingRate: string;
  markPrice?: string; // documented as present but empty on some rows
}

/** Narrowing helpers for the combined-stream payloads, which arrive as `{ stream, data }`. */
export function isMarkPriceEvent(value: unknown): value is MarkPriceEvent {
  return (value as MarkPriceEvent)?.e === 'markPriceUpdate';
}

export function isForceOrderEvent(value: unknown): value is ForceOrderEvent {
  return (value as ForceOrderEvent)?.e === 'forceOrder';
}

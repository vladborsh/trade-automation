/**
 * OKX v5 public WebSocket payloads — `wss://ws.okx.com:8443/ws/v5/public` (design §4.3).
 *
 * **Confirmed live on 2026-09-28** (the task requires confirming channel names and fields at
 * build time). All three channels subscribed on one socket and all three delivered; the shapes
 * below are copied from the messages that arrived, which are kept verbatim as fixtures in
 * `test/fixtures/okx/`. Every numeric field is a string, as everywhere in OKX v5.
 *
 * On AGENTS.md's repetition rule: these are **payload shapes, not boundaries**, and each is
 * pinned by a committed fixture that the specs parse — a shape that changed would fail the
 * suite, which is stronger than re-probing. The two claims below that ARE behavioural (the
 * `fundingTime`/`nextFundingTime` ordering and the `posSide`/`side` invariant) each say how many
 * observations they rest on.
 *
 * Subscription arguments, as accepted (each answered with `{"event":"subscribe", ...}`):
 *   { channel: 'liquidation-orders', instType: 'SWAP' }   // one channel, ALL swaps
 *   { channel: 'mark-price',   instId: 'BTC-USDT-SWAP' }  // per instrument
 *   { channel: 'funding-rate', instId: 'BTC-USDT-SWAP' }  // per instrument
 */

/** The envelope every data message arrives in. */
export interface OkxMessage<T> {
  arg: { channel: string; instType?: string; instId?: string };
  data: T[];
  event?: string;
}

/**
 * `mark-price`, observed:
 * `{"instId":"BTC-USDT-SWAP","instType":"SWAP","markPx":"83904.3","ts":"1790617266021"}`
 *
 * **No index price.** `mark_funding_1m.index_price` therefore stays null for OKX — the venue's
 * index is a different channel (`index-tickers`, keyed by `BTC-USDT`, not the swap id) and is out
 * of scope for stage 0. Null, never a copy of the mark (§2.3's null-not-zero rule).
 */
export interface OkxMarkPrice {
  instId: string;
  instType: string;
  markPx: string;
  ts: string;
}

/**
 * `funding-rate`, observed (trimmed to the fields used):
 * `{"fundingRate":"0.0000657431176183","fundingTime":"1790640000000",
 *   "nextFundingRate":"","nextFundingTime":"1790668800000","prevFundingTime":"1790611200000",
 *   "settFundingRate":"0.0000709507874477","settState":"settled","method":"current_period", ...}`
 *
 * **The naming trap, verified two independent ways (one WS payload plus the REST history, which
 * is a cross-check rather than a repetition — re-probe if this ever matters more):** `fundingTime` is the **upcoming**
 * settlement and `fundingRate` its current prediction; `nextFundingTime` is the interval *after*
 * that one. The observed values differ by exactly 8 h in each direction
 * (prev 1790611200000 → funding 1790640000000 → next 1790668800000), and
 * `/api/v5/public/funding-rate-history`'s newest row carried `fundingTime = 1790611200000`, i.e.
 * the `prevFundingTime` above. So `mark_funding_1m.next_funding_time` takes **`fundingTime`**,
 * not `nextFundingTime` — the opposite of what the field names suggest.
 */
export interface OkxFundingRate {
  instId: string;
  instType: string;
  fundingRate: string;
  fundingTime: string;
  nextFundingRate: string;
  nextFundingTime: string;
  prevFundingTime?: string;
  settFundingRate?: string;
  settState?: string;
  method?: string;
  premium?: string;
  ts: string;
}

/**
 * `liquidation-orders`, observed:
 * `{"instType":"SWAP","instId":"LINK-USD-SWAP","instFamily":"LINK-USD","uly":"LINK-USD",
 *   "details":[{"bkLoss":"0","bkPx":"15.226","ccy":"","posSide":"short","side":"buy","sz":"12","ts":"..."}]}`
 *
 * Two things measured over a 45 s sample (9 messages, `test/fixtures/okx/liquidation-orders.json`):
 *
 * 1. **`posSide` is the liquidated side directly.** Over a 45 s live sample, **9 events across 9
 *    messages**, only two combinations ever occurred — `long/sell` (6) and `short/buy` (3) —
 *    i.e. `side` is the *closing order's* side and is always the inverse of `posSide`, the same
 *    relationship Binance's `forceOrder` has. Nine events is a sample, not a proof, which is why
 *    the mapper ASSERTS the invariant at runtime rather than trusting it. The
 *    mapper takes `posSide` and asserts the invariant, so a change in the venue's convention
 *    fails loudly instead of silently inverting every liquidation.
 * 2. **The channel carries every swap, including inverse ones** (`LINK-USD-SWAP` arrived
 *    unbidden). The collector filters to the universe's `okx_swap` ids.
 *
 * **`sz` is in CONTRACTS, not base units** — see `contract-size.ts`, which is the difference
 * between 12 DOGE and 12 000 DOGE.
 */
export interface OkxLiquidationDetail {
  bkLoss: string;
  bkPx: string;
  ccy: string;
  posSide: 'long' | 'short';
  side: 'buy' | 'sell';
  sz: string;
  ts: string;
}

export interface OkxLiquidation {
  instType: string;
  instId: string;
  instFamily?: string;
  uly?: string;
  details: OkxLiquidationDetail[];
}


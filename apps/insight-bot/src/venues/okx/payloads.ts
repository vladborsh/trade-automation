/**
 * WD-008 — OKX v5 REST payload shapes, split out of `collectors/okx/payloads.ts` (which keeps the
 * socket and liquidation shapes). Every numeric field is a string, as everywhere in OKX v5.
 */

/**
 * `/api/v5/public/funding-rate-history` row, observed:
 * `{"fundingRate":"0.0000709507874477","fundingTime":"1790611200000","instId":"BTC-USDT-SWAP",
 *   "realizedRate":"0.0000709507874477","method":"current_period","formulaType":"withRate"}`
 *
 * Here `fundingTime` is a **settled** interval (the opposite sense to the WS `funding-rate` channel in `collectors/okx/payloads.ts`), and
 * `realizedRate` is what was actually charged. 100 rows per page (design §4.3).
 */
export interface OkxFundingHistoryRow {
  instId: string;
  instType?: string;
  fundingRate: string;
  realizedRate?: string;
  fundingTime: string;
  method?: string;
  formulaType?: string;
}

/** `/api/v5/public/instruments?instType=SWAP` — the fields `contract-size.ts` needs. */
export interface OkxInstrument {
  instId: string;
  ctVal: string;
  ctValCcy: string;
  ctMult: string;
  ctType?: string;
  state?: string;
}

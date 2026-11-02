/**
 * WD-008 — Bybit v5 REST payload shapes, split out of `collectors/bybit/payloads.ts` (which keeps
 * the socket and liquidation shapes).
 */

/** `GET /v5/market/funding/history` row. */
export interface BybitFundingHistoryRow {
  symbol: string;
  fundingRate: string;
  fundingRateTimestamp: string; // epoch ms, as a string
}

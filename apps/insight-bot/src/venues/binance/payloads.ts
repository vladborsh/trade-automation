/**
 * WD-008 — Binance USD-M REST payload shapes, split out of `collectors/binance-perp/payloads.ts`
 * (which keeps the socket and liquidation shapes). Sources: Binance USD-M futures API docs, read
 * 2026-09-28. Every numeric field arrives as a string; the mappers do the one conversion.
 */

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

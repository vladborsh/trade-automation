import { z } from 'zod';

/**
 * The three Binance USD-M responses the universe summary reads, as zod schemas.
 *
 * Pinned by committed fixtures (`test/fixtures/binance/ticker24hr.json`, `premiumIndex.json`,
 * `openInterestHist-1h.json`, captured 2026-10-24) that `universe-summary.spec.ts` parses, so the
 * build fails the day the venue renames a field (AGENTS.md: a shape is pinned by a fixture, a
 * number is not). Only the fields this feature reads are declared; the rest pass through.
 *
 * Binance sends every number as a STRING. They stay strings here and become numbers in
 * `universe-summary.ts`, where an unparsable one turns into `null` rather than `NaN`.
 */

/** One element of `GET /fapi/v1/ticker/24hr` without `symbol` (weight 40, every symbol). */
export const Ticker24hRowSchema = z.object({
  symbol: z.string(),
  lastPrice: z.string(),
  priceChangePercent: z.string(),
}).passthrough();
export type Ticker24hRow = z.infer<typeof Ticker24hRowSchema>;

/** One element of `GET /fapi/v1/premiumIndex` without `symbol` (weight 10, every symbol). */
export const PremiumIndexSummaryRowSchema = z.object({
  symbol: z.string(),
  /** The rate predicted for the interval in progress, a fraction per interval. Not settled. */
  lastFundingRate: z.string(),
  nextFundingTime: z.number(),
}).passthrough();
export type PremiumIndexSummaryRow = z.infer<typeof PremiumIndexSummaryRowSchema>;

/** One element of `GET /futures/data/openInterestHist?period=1h` (weight 1, no weight header). */
export const OiHistRowSchema = z.object({
  symbol: z.string(),
  sumOpenInterest: z.string(),
  timestamp: z.number(),
}).passthrough();
export type OiHistRow = z.infer<typeof OiHistRowSchema>;

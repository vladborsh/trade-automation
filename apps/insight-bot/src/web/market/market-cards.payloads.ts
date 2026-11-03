import { z } from 'zod';

/**
 * The three keyless responses the live market cards read, as zod schemas.
 *
 * Pinned by committed fixtures (`test/fixtures/context/fng.json`, `global.json`, captured
 * 2026-09-28, and `coins-markets.json`, captured 2026-10-24) that `live-market-cards.spec.ts`
 * parses, so the build fails the day a venue renames a field. Only the fields read are declared.
 */

/** `GET api.alternative.me/fng/?limit=N`: every field a string, `timestamp` in SECONDS. */
export const FngPayloadSchema = z.object({
  data: z.array(z.object({
    value: z.string(),
    value_classification: z.string(),
    timestamp: z.string(),
  }).passthrough()),
  metadata: z.object({ error: z.string().nullable() }).passthrough().optional(),
}).passthrough();

/** `GET api.coingecko.com/api/v3/global`: dominance in PERCENT, `updated_at` in seconds. */
export const GlobalPayloadSchema = z.object({
  data: z.object({
    total_market_cap: z.record(z.number()),
    market_cap_percentage: z.record(z.number()),
    /** Already a percentage (`-2.63` is −2.63 %). */
    market_cap_change_percentage_24h_usd: z.number().nullable().optional(),
    updated_at: z.number().optional(),
  }).passthrough(),
});
export type GlobalPayload = z.infer<typeof GlobalPayloadSchema>;

/**
 * One element of `GET api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=…`. Nullable
 * where CoinGecko sends null for a coin it has no figure for; a null cap is not a zero cap.
 */
export const CoinMarketRowSchema = z.object({
  id: z.string(),
  current_price: z.number().nullable(),
  market_cap: z.number().nullable(),
  /** Already a percentage. */
  market_cap_change_percentage_24h: z.number().nullable(),
}).passthrough();
export type CoinMarketRow = z.infer<typeof CoinMarketRowSchema>;

/**
 * IB-087 — one element of `GET /api/v3/coins/markets?vs_currency=usd&order=market_cap_desc
 * &per_page=250&price_change_percentage=1h,24h,7d`. The three `…_in_currency` changes are present
 * only because they are requested; already percentages. Pinned by
 * `test/fixtures/context/coins-markets-top.json` (captured 2026-11-03), parsed in `caps.spec.ts`.
 */
export const CapsMarketRowSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  current_price: z.number().nullable(),
  market_cap: z.number().nullable(),
  price_change_percentage_1h_in_currency: z.number().nullable().optional(),
  price_change_percentage_24h_in_currency: z.number().nullable().optional(),
  price_change_percentage_7d_in_currency: z.number().nullable().optional(),
}).passthrough();
export type CapsMarketRow = z.infer<typeof CapsMarketRowSchema>;

/**
 * IB-087 — one element of `…/coins/markets?vs_currency=usd&category=stablecoins&per_page=250`:
 * only the id (to flag a coin as a stablecoin) and its cap (for the tail outside the top 250).
 * Pinned by `test/fixtures/context/coins-markets-stablecoins.json` (captured 2026-11-03).
 */
export const StablecoinRowSchema = z.object({
  id: z.string(),
  market_cap: z.number().nullable(),
}).passthrough();
export type StablecoinRow = z.infer<typeof StablecoinRowSchema>;

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

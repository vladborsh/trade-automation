import { z } from 'zod';

/**
 * architecture/insight-bot-web-dashboard.md §2, §4, §10 — the market-context page's two reads:
 * `GET /api/web/context/fear-greed` and `GET /api/web/context/market-cap`, both behind the
 * session guard.
 *
 * **Every derived share is computed at read time and never stored** (§10). The stored rows are
 * what the venues sent (`fear_greed`, `market_cap_global`, `market_cap_coin`); a ratio is a view
 * of them. Storing it would create a second truth that silently drifts when a coin enters or
 * leaves the top 20 — the denominator changes, and every historical row would have to be
 * rewritten to stay consistent.
 */

/** A UTC day, `YYYY-MM-DD` — the grain both of these series are published at. */
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------------------------------------------------------------------------------------------
// Fear & Greed (alternative.me, one value per UTC day, full history since 2018-02-01)
// ---------------------------------------------------------------------------------------------

export const WebFearGreedPointSchema = z.object({
  day: Day,
  value: z.number().int().min(0).max(100),
  /** The venue's own wording ("Extreme Fear", "Greed", …) — kept verbatim, never re-derived. */
  classification: z.string().min(1),
});
export type WebFearGreedPoint = z.infer<typeof WebFearGreedPointSchema>;

export const WebFearGreedResponseSchema = z.object({
  points: z.array(WebFearGreedPointSchema),
  /**
   * The newest point in the WHOLE series, even when the requested window ends earlier — the gauge
   * shows "today" and a range picker must not be able to make it lie by showing an old value as
   * current. Null only when nothing has ever been collected.
   */
  latest: WebFearGreedPointSchema.nullable(),
  /** True when the server thinned the points; the page says so rather than implying full grain. */
  downsampled: z.boolean(),
});
export type WebFearGreedResponse = z.infer<typeof WebFearGreedResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Market cap: global dominance (forward-collected) and the top-20 per-coin caps (365 days)
// ---------------------------------------------------------------------------------------------

/** One `/global` sample: BTC's share of the WHOLE market, as CoinGecko computes it. */
export const WebDominancePointSchema = z.object({
  /** ms UTC. */
  ts: z.number().int().nonnegative(),
  totalUsd: z.number(),
  /** Null when the venue omitted the coin from `market_cap_percentage` — never 0 (§10). */
  btcPct: z.number().nullable(),
  ethPct: z.number().nullable(),
});
export type WebDominancePoint = z.infer<typeof WebDominancePointSchema>;

/** One coin's slice of one day, as a fraction of Σ of the top-20 caps held for that day. */
export const WebCoinShareSchema = z.object({
  coin: z.string().min(1),
  capUsd: z.number().nullable(),
  /** 0..1 of Σ top-20 that day; null when this coin has no cap that day (it is not 0 % — §10). */
  share: z.number().min(0).max(1).nullable(),
});
export type WebCoinShare = z.infer<typeof WebCoinShareSchema>;

export const WebMarketCapDaySchema = z.object({
  day: Day,
  /** Σ of the top-20 caps held for this day — the denominator of every `share` in `coins`. */
  totalUsd: z.number(),
  /** How many of the top 20 actually had a cap that day: the denominator's honesty. */
  coinsCounted: z.number().int().nonnegative(),
  coins: z.array(WebCoinShareSchema),
  /** BTC's share of Σ top-20 — the ratio §10 asks for, which is NOT `/global`'s dominance. */
  btcShare: z.number().min(0).max(1).nullable(),
});
export type WebMarketCapDay = z.infer<typeof WebMarketCapDaySchema>;

/** The table row: where a coin stands now, and how it moved. */
export const WebMarketCapCurrentSchema = z.object({
  coin: z.string().min(1),
  capUsd: z.number().nullable(),
  priceUsd: z.number().nullable(),
  /** Fractional change, e.g. -0.031 for -3.1 %; null when the comparison day is not held. */
  change24h: z.number().nullable(),
  change7d: z.number().nullable(),
  share: z.number().min(0).max(1).nullable(),
});
export type WebMarketCapCurrent = z.infer<typeof WebMarketCapCurrentSchema>;

export const WebMarketCapResponseSchema = z.object({
  /** The stacked-share history: one entry per day held, oldest first. */
  days: z.array(WebMarketCapDaySchema),
  /** The current table, ordered by cap, largest first. */
  current: z.array(WebMarketCapCurrentSchema),
  /** `/global` samples in the window — the forward-collected dominance line. */
  dominance: z.array(WebDominancePointSchema),
  /**
   * The first `/global` sample ever stored. §10: that series is forward-only, because the
   * historical endpoint is paid — so the line has a real start date and the page must show it
   * rather than letting a reader assume the data goes back as far as the axis does.
   */
  dominanceStart: z.number().int().nonnegative().nullable(),
  downsampled: z.boolean(),
});
export type WebMarketCapResponse = z.infer<typeof WebMarketCapResponseSchema>;

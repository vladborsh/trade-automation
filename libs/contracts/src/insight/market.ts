import { z } from 'zod';

/**
 * Market page redesign (architecture/market-page-design-2026-11-03.md).
 *
 * The page-wide period switch (D14): every market block's endpoint takes `?period=` from this one
 * enum, so the blocks cannot drift apart in what "24h" means. IB-084/IB-085 reuse it.
 */
export const WEB_MARKET_PERIODS = ['1h', '4h', '24h', '7d'] as const;
export const WebMarketPeriodSchema = z.enum(WEB_MARKET_PERIODS);
export type WebMarketPeriod = z.infer<typeof WebMarketPeriodSchema>;

/** D11: the treemap shows this many coins, largest first. */
export const WEB_CAPS_TOP_N = 30;

/**
 * One coin of the caps treemap (IB-087, D11). `symbol` is the ticker, upper-case: an identifier,
 * never translated.
 */
export const WebCapsCoinSchema = z.object({
  /** CoinGecko id: stable across renames of the ticker. */
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string(),
  /** Area of the tile. */
  capUsd: z.number().positive(),
  priceUsd: z.number().nullable(),
  /**
   * Price change over the requested period, in PERCENT (`-2.5` is −2.5 %). Null when the source
   * has no figure for this coin, or when the whole period is refused (`changeUnavailable`).
   */
  changePct: z.number().nullable(),
  /** In CoinGecko's `stablecoins` category: the client may colour or omit it; it is counted in `stablesPct`. */
  stable: z.boolean(),
});
export type WebCapsCoin = z.infer<typeof WebCapsCoinSchema>;

/**
 * The dominance bar (D11): BTC / ETH / stablecoins / everything else, in PERCENT of the total crypto
 * market cap. **The four always sum to 100** (`restPct` is the remainder; a negative remainder means
 * the sources disagree and the server refuses the bar instead of drawing it).
 */
export const WebCapsDominanceSchema = z.object({
  btcPct: z.number().nonnegative(),
  ethPct: z.number().nonnegative(),
  stablesPct: z.number().nonnegative(),
  restPct: z.number().nonnegative(),
  totalCapUsd: z.number().positive(),
  /** CoinGecko's own 24h change of the total cap, PERCENT; null when it sends none. */
  totalCapChangePct24h: z.number().nullable(),
  /** How many stablecoins were summed into `stablesPct`. */
  stablesCounted: z.number().int().nonnegative(),
  /** When CoinGecko computed `/global` (ISO-8601). */
  asOf: z.string(),
});
export type WebCapsDominance = z.infer<typeof WebCapsDominanceSchema>;

/**
 * Why a part of the answer is missing. A refusal is always explicit — never an empty list or a zero.
 * - `period_not_served` — the source publishes no change for this period (CoinGecko serves 1h, 24h
 *   and 7d, not 4h). Every `changePct` is null.
 * - `source_unavailable` — the upstream call failed or timed out; try again on the next poll.
 * - `sources_disagree` — the dominance parts add up to more than 100 % (a remainder below zero).
 */
export const WebCapsUnavailableSchema = z.enum(['period_not_served', 'source_unavailable', 'sources_disagree']);
export type WebCapsUnavailable = z.infer<typeof WebCapsUnavailableSchema>;

/** `GET /api/web/market/caps?period=` (IB-087). Cached 120 s on the server. */
export const WebCapsResponseSchema = z.object({
  period: WebMarketPeriodSchema,
  /** Top {@link WEB_CAPS_TOP_N} by market cap, largest first. Empty only together with `coinsUnavailable`. */
  coins: z.array(WebCapsCoinSchema),
  coinsUnavailable: WebCapsUnavailableSchema.nullable(),
  /** Set (to `period_not_served`) when the period has no per-coin change at the source. */
  changeUnavailable: WebCapsUnavailableSchema.nullable(),
  dominance: WebCapsDominanceSchema.nullable(),
  dominanceUnavailable: WebCapsUnavailableSchema.nullable(),
  /**
   * Attribution the page must show next to the block (CoinGecko's free tier requires it; the
   * terms question itself is on the owner's list, design §5).
   */
  source: z.object({ name: z.string(), url: z.string().url() }),
  /** When the server built this answer (ISO-8601). */
  generatedAt: z.string(),
}).superRefine((r, ctx) => {
  // A refusal is explicit: an empty list without a reason, or a reason with data, is malformed.
  if ((r.coins.length === 0) !== (r.coinsUnavailable !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['coinsUnavailable'], message: 'coins is empty exactly when coinsUnavailable is set' });
  }
  if ((r.dominance === null) !== (r.dominanceUnavailable !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dominanceUnavailable'], message: 'dominance is null exactly when dominanceUnavailable is set' });
  }
  if (r.changeUnavailable !== null && r.coins.some((c) => c.changePct !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['changeUnavailable'], message: 'a refused period carries no changePct' });
  }
  if (r.dominance) {
    const d = r.dominance;
    const sum = d.btcPct + d.ethPct + d.stablesPct + d.restPct;
    if (Math.abs(sum - 100) > 1e-6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dominance'], message: `dominance parts sum to ${sum}, not 100` });
    }
  }
});
export type WebCapsResponse = z.infer<typeof WebCapsResponseSchema>;

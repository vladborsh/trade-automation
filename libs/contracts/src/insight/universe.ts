import { z } from 'zod';

/** IB-031 — the instrument picker's list (architecture/insight-bot-web-dashboard.md §4). */

export const WebUniverseSymbolSchema = z.object({
  id: z.string(),
  base: z.string(),
  quote: z.string(),
  /** 1-based rank by 30-day quote volume at the last universe revision; null when unranked. */
  volumeRank: z.number().int().positive().nullable(),
  inSignalSet: z.boolean(),
  /** Which venues carry this symbol, so the page can grey out panes it cannot fill. */
  venues: z.object({
    binancePerp: z.boolean(),
    binanceSpot: z.boolean(),
    bybitLinear: z.boolean(),
    okxSwap: z.boolean(),
  }),
});
export type WebUniverseSymbol = z.infer<typeof WebUniverseSymbolSchema>;

export const WebUniverseTopResponseSchema = z.object({ symbols: z.array(WebUniverseSymbolSchema) });
export type WebUniverseTopResponse = z.infer<typeof WebUniverseTopResponseSchema>;

/**
 * The instrument page's symbol dropdown: one row per coin of the top list, read live from Binance
 * USD-M (no database). Every venue-derived figure is nullable on its own, so one symbol the
 * venue does not answer for shows dashes in its row instead of failing the list.
 */
export const WebUniverseSummaryRowSchema = z.object({
  id: z.string(),
  base: z.string(),
  volumeRank: z.number().int().positive().nullable(),
  /** Last traded perp price. */
  lastPrice: z.number().nullable(),
  /** Price change over the venue's rolling 24 h, in percent (1.5 means +1.5 %). */
  changePct24h: z.number().nullable(),
  /**
   * The funding rate the venue currently predicts for the interval in progress, as a FRACTION
   * per interval (0.0001 is 0.01 %). Binance calls this `lastFundingRate`; it is not yet settled.
   */
  fundingRate: z.number().nullable(),
  /** When that interval settles, epoch ms. */
  nextFundingTimeMs: z.number().int().nullable(),
  /** Open interest change from 24 hourly samples ago to the newest, in percent. */
  oiChangePct24h: z.number().nullable(),
});
export type WebUniverseSummaryRow = z.infer<typeof WebUniverseSummaryRowSchema>;

export const WebUniverseSummaryResponseSchema = z.object({
  /** When the venue figures were read, epoch ms; the server caches them for about a minute. */
  asOfMs: z.number().int(),
  venue: z.literal('binance-perp'),
  rows: z.array(WebUniverseSummaryRowSchema),
});
export type WebUniverseSummaryResponse = z.infer<typeof WebUniverseSummaryResponseSchema>;

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

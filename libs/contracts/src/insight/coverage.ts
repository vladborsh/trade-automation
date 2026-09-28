import { z } from 'zod';

/**
 * architecture/insight-bot-web-dashboard.md §2, §4 — `GET /api/web/coverage`: per symbol × series,
 * the first and last row held and the months missing between them (IB-012's coverage report, read
 * live). Behind the session guard, like everything else under `/api/web` except the exchange.
 */
export const WebCoverageRowSchema = z.object({
  symbol: z.string(),
  series: z.string(),
  /** ms UTC of the first and last stored row; null when the series holds nothing for the symbol. */
  firstRow: z.number().int().nullable(),
  lastRow: z.number().int().nullable(),
  /** Months (YYYY-MM) with no rows between `firstRow` and `lastRow` — the holes worth backfilling. */
  missingMonths: z.array(z.string()).default([]),
});
export type WebCoverageRow = z.infer<typeof WebCoverageRowSchema>;

export const WebCoverageResponseSchema = z.object({
  rows: z.array(WebCoverageRowSchema),
});
export type WebCoverageResponse = z.infer<typeof WebCoverageResponseSchema>;

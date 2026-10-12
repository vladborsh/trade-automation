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

/**
 * IB-BUG-010 — how much of a window a collector stream actually covered.
 *
 * This exists because the series rows above cannot answer it. "No liquidation in this hour" and
 * "nobody was listening in this hour" look identical in the data, and a statistic that cannot tell
 * them apart reads downtime as a quiet market: measured on `insight_coord`, only 9 of the 226 hours
 * since 2026-09-28 hold any liquidation at all, because the collectors were down through the pause.
 * A ratio computed on elapsed hours is then understated 25-fold. Consumers divide by
 * `coveredHours`, never by `elapsedHours`.
 */
export const WebCollectorCoverageSchema = z.object({
  /** The collector stream id, e.g. `bybit:allLiquidation`. An identifier — not translated. */
  stream: z.string(),
  venue: z.string(),
  /** Hours inside the window during which the stream was running. The honest denominator. */
  coveredHours: z.number(),
  /**
   * Hours the window spans, clipped to `firstSeen`: time before the collector ever ran is not
   * counted as elapsed either, so a new database does not report a huge uncovered span it was
   * never responsible for.
   */
  elapsedHours: z.number(),
  /** ms UTC of the first and last known liveness; null when the stream has never run. */
  firstSeen: z.number().int().nullable(),
  lastSeen: z.number().int().nullable(),
  /** Number of recorded outages overlapping the window. */
  outages: z.number().int(),
});
export type WebCollectorCoverage = z.infer<typeof WebCollectorCoverageSchema>;

/**
 * IB-BUG-010 — a `liquidations` row whose `(venue, symbol)` matches no spelling in `symbols`.
 *
 * Such a row is unreachable from any canonical id: it is stored, counted by nothing and reaches no
 * page. Measured 0 on 2026-10-07 (dev-2) and 0 again on 2026-10-12 — two observations, both zero,
 * which is a note rather than a guarantee. It is surfaced for the day it stops being zero, which is
 * the day a venue renames a contract.
 */
export const WebUnmappedLiquidationSchema = z.object({
  venue: z.string(),
  symbol: z.string(),
  rows: z.number().int(),
});
export type WebUnmappedLiquidation = z.infer<typeof WebUnmappedLiquidationSchema>;

export const WebCoverageResponseSchema = z.object({
  rows: z.array(WebCoverageRowSchema),
  /** Defaulted, so a client built against the earlier shape keeps parsing. */
  collectors: z.array(WebCollectorCoverageSchema).default([]),
  unmapped: z
    .object({ total: z.number().int(), rows: z.array(WebUnmappedLiquidationSchema) })
    .default({ total: 0, rows: [] }),
  /** The window `collectors` was computed over, so the page can state its basis. */
  windowDays: z.number().int().default(30),
});
export type WebCoverageResponse = z.infer<typeof WebCoverageResponseSchema>;

import { z } from 'zod';

/**
 * architecture/insight-bot-web-dashboard.md §4 — the dashboard's health surface, under
 * `/api/web/health/*` and behind the session guard (IB-029).
 *
 * **This is not the ops `GET /health`.** insight-bot serves two different things called health and
 * they must stay apart: `/health` is the unauthenticated liveness probe (§6.1, and what the SPA
 * fallback excludes), while these endpoints expose per-stream detail, gap history and database
 * internals that only a logged-in member may read. Anyone tempted to "unify" them would be turning
 * the detailed one public — keep both.
 */

export const WebStreamModeSchema = z.enum(['ws', 'degraded']);
export type WebStreamMode = z.infer<typeof WebStreamModeSchema>;

export const WebStreamHealthRowSchema = z.object({
  id: z.string(),
  venue: z.string(),
  mode: WebStreamModeSchema.default('ws'),
  /** Why it is degraded, when it is; null on a healthy stream. */
  reason: z.string().nullable().default(null),
  /** Seconds since the last message; null when the stream has never delivered one. */
  lastMessageAgeSec: z.number().nonnegative().nullable(),
  reconnects24h: z.number().int().nonnegative(),
  gapsOpen: z.number().int().nonnegative(),
});
export type WebStreamHealthRow = z.infer<typeof WebStreamHealthRowSchema>;

/** §4.5 — the two Binance budgets are metered separately by the venue and reported separately. */
export const WebWeightGaugeSchema = z.object({
  market: z.enum(['futures', 'spot']),
  used1m: z.number().nonnegative(),
  budget1m: z.number().positive(),
});
export type WebWeightGauge = z.infer<typeof WebWeightGaugeSchema>;

export const WebStreamsResponseSchema = z.object({
  streams: z.array(WebStreamHealthRowSchema),
  weights: z.array(WebWeightGaugeSchema).default([]),
});
export type WebStreamsResponse = z.infer<typeof WebStreamsResponseSchema>;

/** One cell of the symbol × day grid: what a day's report said about one series. */
export const WebGapReportCellSchema = z.object({
  day: z.string(), // YYYY-MM-DD (UTC)
  symbol: z.string(),
  series: z.string(), // 'candles_1m' | 'open_interest_5m' | …
  missing: z.number().int().nonnegative(),
  expected: z.number().int().nonnegative(),
});
export type WebGapReportCell = z.infer<typeof WebGapReportCellSchema>;

export const WebGapReportsResponseSchema = z.object({
  days: z.array(z.string()),
  cells: z.array(WebGapReportCellSchema),
});
export type WebGapReportsResponse = z.infer<typeof WebGapReportsResponseSchema>;

export const WebDbHealthResponseSchema = z.object({
  sizeBytes: z.number().nonnegative(),
  /** The furthest month a partition exists for, as YYYY-MM; null when none are prepared. */
  partitionHorizon: z.string().nullable(),
  partitionCount: z.number().int().nonnegative(),
});
export type WebDbHealthResponse = z.infer<typeof WebDbHealthResponseSchema>;

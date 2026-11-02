import { z } from 'zod';

/**
 * architecture/insight-bot-web-dashboard.md §4 — the dashboard's health surface, under
 * `/api/web/health/*` and behind the session guard (IB-029).
 *
 * **This is not the ops `GET /health`.** insight-bot serves two different things called health and
 * they must stay apart: `/health` is the unauthenticated liveness probe (§6.1, and what the SPA
 * fallback excludes), while these endpoints expose per-stream detail, liquidation-collector uptime and database
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

/**
 * WD-009 — one liquidation collector's record over a window, in three states, because "no rows"
 * means two different things and a page must not show them alike (IB-BUG-010):
 * - `recorded` — the collector wrote liquidations in the window;
 * - `no_events` — it was listening the WHOLE window and the venue liquidated nothing;
 * - `not_recorded` — no rows, and for some of the window nobody was listening (an outage, a stream
 *   not yet instrumented, or a collector younger than the window). Rows from that window may be
 *   missing; the tape cannot say.
 */
export const WebUptimeStateSchema = z.enum(['recorded', 'no_events', 'not_recorded']);
export type WebUptimeState = z.infer<typeof WebUptimeStateSchema>;

export const WebUptimeWindowSchema = z.object({
  hours: z.number().int().positive(),
  state: WebUptimeStateSchema,
  /** Hours of the window the collector was listening, to 0.1 h. */
  coveredHours: z.number().nonnegative(),
  /** The window's length in hours — wall clock, not "since the collector existed". */
  elapsedHours: z.number().nonnegative(),
  /** Outage rows (`collector_gaps`) overlapping the window. */
  outages: z.number().int().nonnegative(),
  /** Liquidation rows written in the window. */
  rows: z.number().int().nonnegative(),
});
export type WebUptimeWindow = z.infer<typeof WebUptimeWindowSchema>;

export const WebLiquidationUptimeSchema = z.object({
  stream: z.string(),
  venue: z.string(),
  /** Whether this stream has ever written a heartbeat; false means its outages are not recorded at all. */
  instrumented: z.boolean(),
  /** Newest liquidation row from this venue in the last 7 days, epoch ms; null when none. */
  lastRowAt: z.number().nullable(),
  /** Last heartbeat, epoch ms; null when never instrumented. */
  lastSeen: z.number().nullable(),
  /** 24 h, then 7 days. */
  windows: z.array(WebUptimeWindowSchema),
});
export type WebLiquidationUptime = z.infer<typeof WebLiquidationUptimeSchema>;

export const WebStreamsResponseSchema = z.object({
  streams: z.array(WebStreamHealthRowSchema),
  weights: z.array(WebWeightGaugeSchema).default([]),
  /** WD-009: the three liquidation collectors' record (was the coverage page's collector block). */
  liquidationUptime: z.array(WebLiquidationUptimeSchema).default([]),
});
export type WebStreamsResponse = z.infer<typeof WebStreamsResponseSchema>;

export const WebDbHealthResponseSchema = z.object({
  sizeBytes: z.number().nonnegative(),
  /** The furthest month a partition exists for, as YYYY-MM; null when none are prepared. */
  partitionHorizon: z.string().nullable(),
  partitionCount: z.number().int().nonnegative(),
});
export type WebDbHealthResponse = z.infer<typeof WebDbHealthResponseSchema>;

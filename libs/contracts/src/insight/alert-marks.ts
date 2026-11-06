import { z } from 'zod';
import { LiqByVenueSchema, LiqSideSchema } from './market-alerts';
import { FUNDING_ALERT_EVENTS, FundingSideSchema } from './funding-alerts';

/**
 * IB-129 (alerts design §5) — the liquidation and funding alerts as marks on the instrument chart:
 * `GET /api/web/series/alert-marks?symbol&from&to` (epoch ms, like every series route). One read of
 * `market_alerts` for the window, no venue call.
 *
 * **Which rows are marks:**
 * - `source = 'live'` only: a history run's rows (`backfill`) were never alerts and are never pooled with
 *   live ones (V32);
 * - `late = false` only: a late row was journalled after downtime and never sent (C2);
 * - liquidations: the coin's own threshold crossing (`event = 'alert'`), at its crossing moment. Since IB-143
 *   the message is per market event, and every member coin of an event has its own `alert` row, so the
 *   crossing is the coin's fact on its own chart. The event rows (`event`, `event_continuing`) and the
 *   retired per-coin `continuing` are not marks: the first restates the crossings, the others are later
 *   moments of the same cascade;
 * - funding: `enter` (at the episode start) and `flip` (at the first opposite check).
 * A mark is the journal's fact, sent or not: the per-coin `alert` row is never sent itself since IB-143.
 */

export const WEB_MAX_ALERT_MARKS = 500;

/** A liquidation crossing: the coin's 5-minute sum reached its threshold at `at`. */
export const WebLiqAlertMarkSchema = z.object({
  type: z.literal('liq'),
  /** Unix seconds: the crossing moment. */
  at: z.number().int(),
  /** The liquidated side: `long` = longs were liquidated (forced sells). */
  side: LiqSideSchema,
  sumUsd: z.number().nonnegative(),
  thresholdUsd: z.number().positive(),
  byVenue: LiqByVenueSchema,
}).strict();
export type WebLiqAlertMark = z.infer<typeof WebLiqAlertMarkSchema>;

/** A funding alert: `enter` an extreme, or `flip` the sign after a sustained one. */
export const WebFundingAlertMarkSchema = z.object({
  type: z.literal('funding'),
  event: z.enum(FUNDING_ALERT_EVENTS),
  /** Unix seconds: the episode start (`enter`) or the first opposite check (`flip`). */
  at: z.number().int(),
  /** The EPISODE's side: `high` = longs pay. For a flip, the new sign is the opposite. */
  side: FundingSideSchema,
  /** The rate normalised to 8 h, a fraction (0.0001 = 0.01 %), at the confirming check. */
  ratePer8h: z.number().finite(),
  /** `flip` only: how long the episode lasted, hours. */
  episodeHours: z.number().nonnegative().nullable(),
}).strict();
export type WebFundingAlertMark = z.infer<typeof WebFundingAlertMarkSchema>;

export const WebAlertMarkSchema = z.discriminatedUnion('type', [WebLiqAlertMarkSchema, WebFundingAlertMarkSchema]);
export type WebAlertMark = z.infer<typeof WebAlertMarkSchema>;

export const WebAlertMarksResponseSchema = z.object({
  symbol: z.string(),
  /** Oldest first. */
  marks: z.array(WebAlertMarkSchema).max(WEB_MAX_ALERT_MARKS),
  /** More rows than `WEB_MAX_ALERT_MARKS` in the window: the NEWEST are kept, and the chart says so. */
  truncated: z.boolean(),
}).strict();
export type WebAlertMarksResponse = z.infer<typeof WebAlertMarksResponseSchema>;

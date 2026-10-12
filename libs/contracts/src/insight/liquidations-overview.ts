import { z } from 'zod';

/**
 * Epoch SECONDS, per the ruling in `series.ts`: every wire time field is named `time` and carries
 * seconds, converted to milliseconds only in the client's adapter. Declared here rather than
 * imported because `series.ts` keeps it module-private; promoting it to `common.ts` would be a
 * worthwhile tidy but not inside a task that is already touching this barrel.
 */
const TimeSec = z.number().int().nonnegative();

/**
 * IB-038 — `GET /api/web/liquidations/overview`
 * (architecture/insight-bot-web-dashboard.md §12.2–§12.4).
 *
 * One response feeds all three surfaces: the «Ликвидации сейчас» card, the «Где ликвидируют»
 * table and the «Крупные ликвидации» feed. They are one call because they are one question —
 * "what is being liquidated right now" — and three calls would let the card and the table
 * disagree about the same minute.
 *
 * Two shapes here exist to stop the display from lying, and both are REQUIRED fields rather than
 * optional ones, so a client cannot render the number without the caveat:
 *
 * - **`WebLiquidationNormBasis`** travels with every «× от нормы». The figure is a multiple of a
 *   median, and a multiple means nothing without the sample it came from.
 * - **`venues`** is `{ present, missing }` and never just a total. Bybit + OKX are not the market.
 */

export const WEB_LIQUIDATION_WINDOWS = ['1h', '4h', '24h'] as const;
export const WebLiquidationWindowSchema = z.enum(WEB_LIQUIDATION_WINDOWS);
export type WebLiquidationWindow = z.infer<typeof WebLiquidationWindowSchema>;

/** Seconds per window, so the server and the client cannot disagree about what "4h" means. */
export const WEB_LIQUIDATION_WINDOW_SECONDS: Record<WebLiquidationWindow, number> = {
  '1h': 3_600,
  '4h': 14_400,
  '24h': 86_400,
};

/** The norm period's ceiling (§12.2). The period actually used is reported, and is often shorter. */
export const WEB_LIQUIDATION_NORM_DAYS = 30;

/** §12.2: no ratio until a scope has this much liquidation history. */
export const WEB_LIQUIDATION_MIN_HISTORY_DAYS = 7;

/**
 * What a «× от нормы» was measured against. Sent with every ratio, including a null one.
 *
 * **`windowsObserved` is the honest denominator, not `periodDays`.** A ws collector that was down
 * writes nothing, and nothing is indistinguishable from a quiet market: the liquidation streams
 * record no uptime rows at all (IB-BUG-010). So elapsed time overstates what we actually saw —
 * on the local tape, 226 hours elapsed and 9 of them hold any event. A line that says "за 9 дней"
 * claims nine days of observation we cannot prove; one that says "9 of 226 windows" claims only
 * what is in the table. The client renders the second.
 */
export const WebLiquidationNormBasisSchema = z.object({
  /** Length of the norm period actually used, in days: `min(30, history available)`. */
  periodDays: z.number().nonnegative(),
  /** Consecutive boundary-aligned windows of this length inside the period. */
  windowsInPeriod: z.number().int().nonnegative(),
  /** How many of them hold at least one liquidation — our only evidence the collector was up. */
  windowsObserved: z.number().int().nonnegative(),
  /** The venues the numerator and the median were both computed over (§12.4). */
  venues: z.array(z.string()),
  /**
   * Why there is no ratio, when there is none.
   * - `insufficient_history` — under 7 days for this scope.
   * - `no_norm` — the median is 0: most windows hold nothing, so "× от нормы" has no divisor.
   *   Deliberately not reported as 0 or ∞; it is an absent measurement, not a calm market.
   */
  unavailable: z.enum(['insufficient_history', 'no_norm']).nullable(),
});
export type WebLiquidationNormBasis = z.infer<typeof WebLiquidationNormBasisSchema>;

/** One side of one window: what happened, and what normal looks like for it. */
export const WebLiquidationSideStatsSchema = z.object({
  /** USD liquidated in the trailing window. */
  usd: z.number().nonnegative(),
  /** The median of the aligned window sums over the norm period, in USD; null when unavailable. */
  median: z.number().nonnegative().nullable(),
  /** `usd / median`, or null. Never Infinity, never a stand-in zero. */
  ratio: z.number().nonnegative().nullable(),
});
export type WebLiquidationSideStats = z.infer<typeof WebLiquidationSideStatsSchema>;

export const WebLiquidationWindowStatsSchema = z.object({
  window: WebLiquidationWindowSchema,
  events: z.number().int().nonnegative(),
  /** Longs liquidated — a long being closed out is price falling (§3.3). */
  long: WebLiquidationSideStatsSchema,
  short: WebLiquidationSideStatsSchema,
  total: WebLiquidationSideStatsSchema,
  /** Shared by the three sides: same period, same windows, same venues. */
  basis: WebLiquidationNormBasisSchema,
});
export type WebLiquidationWindowStats = z.infer<typeof WebLiquidationWindowStatsSchema>;

export const WebLiquidationCoinSchema = z.object({
  /** Canonical symbol (`symbols.id`), e.g. `BTCUSDT` — never a venue's own spelling. */
  symbol: z.string(),
  base: z.string(),
  windows: z.array(WebLiquidationWindowStatsSchema),
});
export type WebLiquidationCoin = z.infer<typeof WebLiquidationCoinSchema>;

export const WebLiquidationFeedEventSchema = z.object({
  time: TimeSec,
  symbol: z.string(),
  base: z.string(),
  side: z.enum(['long', 'short']),
  usd: z.number().nonnegative(),
  price: z.number(),
  venue: z.string(),
});
export type WebLiquidationFeedEvent = z.infer<typeof WebLiquidationFeedEventSchema>;

export const WebLiquidationsOverviewResponseSchema = z.object({
  asOf: TimeSec,
  /** Market-wide, one entry per window in `WEB_LIQUIDATION_WINDOWS` order. */
  windows: z.array(WebLiquidationWindowStatsSchema),
  /** Top-20 by `symbols.volume_rank`, canonicalised across venues. */
  perCoin: z.array(WebLiquidationCoinSchema),
  feed: z.array(WebLiquidationFeedEventSchema),
  feedMinUsd: z.number().nonnegative(),
  /**
   * `present` = venues with at least one row in the widest window; `missing` = the venues this
   * deployment collects liquidations from that wrote nothing. §12.4: while `missing` is non-empty
   * every card and table says so, rather than passing the rest off as the whole market.
   */
  venues: z.object({ present: z.array(z.string()), missing: z.array(z.string()) }),
  /**
   * Rows whose venue symbol is not in `symbols`, so they are in the market-wide totals but in no
   * coin's row. Normally 0. Surfaced as a number because the alternative — a join quietly
   * dropping them — looks exactly like a quieter market.
   */
  unmappedRows: z.number().int().nonnegative(),
});
export type WebLiquidationsOverviewResponse = z.infer<typeof WebLiquidationsOverviewResponseSchema>;

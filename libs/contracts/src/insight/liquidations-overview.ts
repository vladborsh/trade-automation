import { z } from 'zod';
import { WebMarketPeriodSchema } from './market';

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
 * A median below this is dust, not a norm, and the ratio refuses.
 *
 * IB-015 swept for guards that compare a float to an exact value after one was found producing a
 * z-score of 1.4e14. This one — `median === 0` — is **not** that bug: a median of exact zeros is
 * exactly zero, so the guard holds. It is exposed to the neighbouring one, a legitimately TINY
 * median: measured on `insight_dev2` on 2026-10-12, the smallest non-zero hourly liquidation sum
 * is **$0.18**, and a $500k hour against a $0.18 norm renders as «×2 700 000 от нормы» on the
 * card a member reads.
 *
 * Not currently reachable — every coin's hourly median on that tape is exactly 0, measured, so
 * the existing guard catches all of them — but it costs one comparison to close, and the card is
 * user-facing. A judgement rather than a measurement: $1 sits above the $0.18 floor and well
 * below the first percentile of non-zero hours.
 *
 * **The query, so the figures can be re-measured without asking anyone:**
 *
 * ```sql
 * with hourly as (
 *   select symbol, date_trunc('hour', ts) as h, sum(notional) as usd
 *     from liquidations group by 1, 2
 * )
 * select count(*), min(usd),
 *        percentile_cont(0.01) within group (order by usd)
 *   from hourly where usd > 0;
 * ```
 *
 * Two observations, and the drift between them is why the query is here rather than only the
 * numbers. Both on `insight_dev2`, 2026-10-12: at the time the floor was chosen, n=?, min
 * $0.1848, p01 **$5.44**; re-run hours later as the tape grew, n=4015, min **$0.1848**, p01
 * **$5.04**. The minimum is stable, the percentile moves with the sample — so `$1` is bracketed
 * on both, but a later reader comparing against a remembered "$5.44" would have had no way to
 * tell drift from a different population.
 */
export const WEB_LIQUIDATION_MIN_NORM_USD = 1;

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

// -------------------------------------------------------------------------------------------------
// IB-084 — the market page's liquidation block (architecture/market-page-design-2026-11-03.md D6,
// D8, D14). Everything below is ADDITIVE: the IB-038 fields keep their meaning for the existing
// card, table and feed until IB-089 replaces them — except that every crypto total, norm and rank
// now counts **crypto only** (D6); TradFi and unclassified symbols are reported beside, not inside.

/** D6: what a liquidation row is about. `unknown` never defaults to crypto. */
export const WEB_ASSET_CLASSES = ['crypto', 'tradfi', 'unknown'] as const;
export const WebAssetClassSchema = z.enum(WEB_ASSET_CLASSES);
export type WebAssetClass = z.infer<typeof WebAssetClassSchema>;

/** Seconds per market period (D14) — the same table the client reads for "what 7d means". */
export const WEB_MARKET_PERIOD_SECONDS = { '1h': 3_600, '4h': 14_400, '24h': 86_400, '7d': 604_800 } as const;

/** D8(a): hourly bars use 1 h buckets for 1h/4h/24h and 4 h buckets for 7d. */
export const WEB_LIQUIDATION_BUCKET_SECONDS = { '1h': 3_600, '4h': 3_600, '24h': 3_600, '7d': 14_400 } as const;

/** One bar of the mirrored hourly chart: market-wide CRYPTO, long up / short down. */
export const WebLiquidationHourBarSchema = z.object({
  /** Bucket start, boundary-aligned (UTC hour / 4-hour). */
  time: TimeSec,
  long: z.number().nonnegative(),
  short: z.number().nonnegative(),
  /** True for the bucket still in progress — its bar is not comparable with the norm yet. */
  partial: z.boolean(),
  /**
   * Empirical percentile of this bucket's total within the norm sample of complete aligned buckets
   * of the same length (0.5 typical, 0.99 rarer than 99 %). Null when the norm is unavailable or
   * the bucket is partial.
   */
  rarity: z.number().min(0).max(1).nullable(),
  /** `rarity` at or above the server's show threshold (0.90, a judgement kept in one constants file) — drawn as an outlier. */
  outlier: z.boolean(),
});
export type WebLiquidationHourBar = z.infer<typeof WebLiquidationHourBarSchema>;

export const WebLiquidationHourlySchema = z.object({
  bucketSec: z.number().int().positive(),
  buckets: z.array(WebLiquidationHourBarSchema),
  /** The per-bucket norm (median of complete aligned buckets), per side; null when unavailable. */
  norm: z.object({ long: z.number().nullable(), short: z.number().nullable(), total: z.number().nullable() }),
  basis: WebLiquidationNormBasisSchema,
});
export type WebLiquidationHourly = z.infer<typeof WebLiquidationHourlySchema>;

/** D8(b): which side of a coin is unusual, against the coin's OWN norm for the period length. */
export const WebLiquidationVerdictSchema = z.object({
  side: z.enum(['long', 'short']),
  /** That side's USD over the period ÷ its median over aligned windows of the same length. */
  ratio: z.number().nonnegative(),
});
export type WebLiquidationVerdict = z.infer<typeof WebLiquidationVerdictSchema>;

/** USD and events over the REQUESTED period (trailing, not aligned). */
export const WebLiquidationPeriodTotalsSchema = z.object({
  usd: z.number().nonnegative(),
  long: z.number().nonnegative(),
  short: z.number().nonnegative(),
  events: z.number().int().nonnegative(),
});
export type WebLiquidationPeriodTotals = z.infer<typeof WebLiquidationPeriodTotalsSchema>;

/** D8(c): one large crypto event, with context and its series (R3's grouping). */
export const WebLiquidationLargeEventSchema = WebLiquidationFeedEventSchema.extend({
  /** `usd ÷` the median single-event size over the norm period; null under 7 days of history. */
  xMedian: z.number().nonnegative().nullable(),
  /**
   * Set when this event belongs to a cascade: ≥ 3 same-side events, each ≥ $100k, first to last
   * within 10 minutes (`seriesCount`, `seriesSpanSec` describe the whole series). Null otherwise.
   */
  seriesId: z.string().nullable(),
  seriesCount: z.number().int().nonnegative(),
  seriesSpanSec: z.number().int().nonnegative(),
});
export type WebLiquidationLargeEvent = z.infer<typeof WebLiquidationLargeEventSchema>;

/** Per-coin additions for the requested period (rows stay crypto-only, by volume rank). */
export const WebLiquidationCoinPeriodSchema = z.object({
  symbol: z.string(),
  base: z.string(),
  totals: WebLiquidationPeriodTotalsSchema,
  /** Null when neither side has a measurable norm (and always for 7d — D14). */
  verdict: WebLiquidationVerdictSchema.nullable(),
  basis: WebLiquidationNormBasisSchema,
});
export type WebLiquidationCoinPeriod = z.infer<typeof WebLiquidationCoinPeriodSchema>;

/** The block for one `?period=`. */
export const WebLiquidationBlockSchema = z.object({
  period: WebMarketPeriodSchema,
  /** Market-wide CRYPTO over the period, with its norm basis (7d always `insufficient_history`). */
  totals: WebLiquidationPeriodTotalsSchema,
  basis: WebLiquidationNormBasisSchema,
  hourly: WebLiquidationHourlySchema,
  perCoin: z.array(WebLiquidationCoinPeriodSchema),
  /** Largest crypto events of the period, biggest first, at or above `largeMinUsd`. */
  large: z.array(WebLiquidationLargeEventSchema),
  largeMinUsd: z.number().nonnegative(),
  /** D6: TradFi perps (commodities, equities, FX, indices on Binance's TRADIFI contracts) — outside every total. */
  tradfi: WebLiquidationPeriodTotalsSchema,
  /** Rows neither class could be given (e.g. a crypto index perp): counted here, in no total. */
  unknown: WebLiquidationPeriodTotalsSchema,
  /**
   * D14: when each period first has a complete window of box tape — the 7d button is disabled
   * until then. Null for a period already available.
   */
  availableFrom: z.record(WebMarketPeriodSchema, TimeSec.nullable()),
});
export type WebLiquidationBlock = z.infer<typeof WebLiquidationBlockSchema>;

export const WebLiquidationsOverviewResponseSchema = z.object({
  asOf: TimeSec,
  /** Market-wide CRYPTO (IB-084, D6), one entry per window in `WEB_LIQUIDATION_WINDOWS` order. */
  windows: z.array(WebLiquidationWindowStatsSchema),
  /** Top-20 CRYPTO coins by `symbols.volume_rank`, canonicalised across venues (TradFi excluded, D6). */
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
  /**
   * IB-084: the market page's block for the requested `?period=` (default 24h). Optional ONLY in
   * this contracts-first commit, so the server keeps compiling until its half lands in the next
   * commit of the same branch, which makes it required.
   */
  block: WebLiquidationBlockSchema.optional(),
});
export type WebLiquidationsOverviewResponse = z.infer<typeof WebLiquidationsOverviewResponseSchema>;

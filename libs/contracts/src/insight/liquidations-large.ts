import { z } from 'zod';
import { WebLiquidationFeedEventSchema, WebLiquidationLargeEventSchema } from './liquidations-overview';

/** Unix seconds; module-private, as in every insight contract module. */
const TimeSec = z.number().int().nonnegative();

/**
 * IB-120 (architecture/market-round2-design-2026-11-05.md §4) — `GET /api/web/liquidations/large`,
 * the `/liquidations` page: every large CRYPTO liquidation of the period from our own tape
 * (Postgres, venue weight 0), filtered, newest first, at most `WEB_LIQUIDATIONS_LARGE_LIMIT` rows.
 *
 * Every filter is a closed set except the coin, so a crawler can only vary the coin; the server's
 * cache is bounded by entries (32) for that reason, not by the filter space.
 */

/** The page's periods: a drill-down of the Market block's 24h and 7d. 1h/4h are the block's own. */
export const WEB_LIQUIDATIONS_LARGE_PERIODS = ['24h', '7d'] as const;
export type WebLiquidationsLargePeriod = (typeof WEB_LIQUIDATIONS_LARGE_PERIODS)[number];

/** The minimum chips, «от $100K | от $1M». $100K is also the series threshold, so no row is below it. */
export const WEB_LIQUIDATIONS_LARGE_MIN_USD = [100_000, 1_000_000] as const;
export type WebLiquidationsLargeMinUsd = (typeof WEB_LIQUIDATIONS_LARGE_MIN_USD)[number];

export const WEB_LIQUIDATIONS_LARGE_SIDES = ['all', 'long', 'short'] as const;
export type WebLiquidationsLargeSide = (typeof WEB_LIQUIDATIONS_LARGE_SIDES)[number];

/**
 * The venues this deployment collects liquidations from — the venue chip's options, and the list
 * the overview's `venues.missing` is computed against (the server reads this constant).
 */
export const WEB_LIQUIDATION_VENUES = ['binance', 'bybit', 'okx'] as const;
export type WebLiquidationVenue = (typeof WEB_LIQUIDATION_VENUES)[number];

/** At most this many rows per answer; the rest are counted in `total`, not paged (§4: no pagination this round). */
export const WEB_LIQUIDATIONS_LARGE_LIMIT = 1_000;

/** A canonical symbol (`BTCUSDT`), or an unmapped venue symbol, as the rows carry it. */
const SymbolParam = z.string().regex(/^[A-Z0-9]{2,30}$/, 'symbol must be an upper-case ticker');

/**
 * The query, as the server parses it and the page keeps it in its URL. Absent = the default; an
 * unknown value is a 400, never a silent default (the overview's `period` rule).
 */
export const WebLiquidationsLargeQuerySchema = z.object({
  period: z.enum(WEB_LIQUIDATIONS_LARGE_PERIODS).default('24h'),
  symbol: z.union([z.literal('all'), SymbolParam]).default('all'),
  minUsd: z.coerce.number()
    .refine((n): n is WebLiquidationsLargeMinUsd => (WEB_LIQUIDATIONS_LARGE_MIN_USD as readonly number[]).includes(n), 'minUsd must be 100000 or 1000000')
    .default(100_000),
  side: z.enum(WEB_LIQUIDATIONS_LARGE_SIDES).default('all'),
  venue: z.enum(['all', ...WEB_LIQUIDATION_VENUES]).default('all'),
});
export type WebLiquidationsLargeQuery = z.output<typeof WebLiquidationsLargeQuerySchema>;

/**
 * One row of the table: the feed event plus its series — the SAME series the Market block's cards
 * carry (`groupSeries`, market-wide, ≥ 3 same-side events ≥ $100K within 10 minutes), computed
 * over the whole period before any filter, so «$1M» or one venue never splits a cascade's count.
 * No `xMedian`: the table does not show it, and it costs a 30-day median query.
 */
export const WebLiquidationLargeRowSchema = WebLiquidationFeedEventSchema.extend(
  WebLiquidationLargeEventSchema.pick({ seriesId: true, seriesCount: true, seriesSpanSec: true }).shape,
);
export type WebLiquidationLargeRow = z.infer<typeof WebLiquidationLargeRowSchema>;

export const WebLiquidationsLargeResponseSchema = z.object({
  asOf: TimeSec,
  /** The period's start, `asOf − period`: the bubble chart's time axis. */
  from: TimeSec,
  /** The filters this answer is for, defaults filled in. */
  query: WebLiquidationsLargeQuerySchema,
  /** Newest first, at most `WEB_LIQUIDATIONS_LARGE_LIMIT`. */
  rows: z.array(WebLiquidationLargeRowSchema).max(WEB_LIQUIDATIONS_LARGE_LIMIT),
  /** Every row matching the filters, shown or not. */
  total: z.number().int().nonnegative(),
  /** `total > rows.length`: the page says «показаны 1 000 последних из {total}». */
  truncated: z.boolean(),
  /**
   * The coin chip's options: every coin with a row in the period at this minimum, whatever the
   * side, venue or coin filter — so choosing BTC does not empty the list of coins to switch to.
   */
  coins: z.array(z.object({ symbol: z.string(), base: z.string() })),
}).superRefine((r, ctx) => {
  if (r.truncated !== r.total > r.rows.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['truncated'], message: 'truncated must equal total > rows.length' });
  }
  if (r.total < r.rows.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['total'], message: 'total cannot be below the rows returned' });
  }
});
export type WebLiquidationsLargeResponse = z.infer<typeof WebLiquidationsLargeResponseSchema>;

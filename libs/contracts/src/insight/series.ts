import { z } from 'zod';

// The caps, the timeframe set and the error body are shared by every /api/web page and live in
// `common.ts` (landed ahead of this file so IB-030 could use them). Re-exported here so a
// consumer of the series contract does not have to know which file they came from.
export {
  WEB_MAX_POINTS, WEB_MAX_1M_RANGE_DAYS, WebTimeframeSchema, WebErrorSchema, WEB_ERROR_CODES,
  type WebTimeframe, type WebError, type WebErrorCode,
} from './common';
import { WebTimeframeSchema } from './common';

/**
 * IB-031 — the instrument view's series contracts
 * (architecture/insight-bot-web-dashboard.md §4).
 *
 * Every type here is `Web`-prefixed: `libs/contracts` is one flat barrel shared with the
 * backtest app, so an unprefixed name compiles silently against that app's export and the error
 * surfaces far from its cause (the standing rule from IB-029).
 *
 * **The caps are part of the contract, not an implementation detail.** The box is a 1 GB
 * t4g.micro running Postgres and Node together, and one page that asks for a year of 1-minute
 * rows would take it down. So the server refuses a range rather than trimming it silently: a
 * caller that gets fewer points than it asked for cannot tell a cap from missing data, which is
 * exactly the confusion the daily gap report exists to avoid.
 */

export const WebMarketSchema = z.enum(['perp', 'spot']);
export type WebMarket = z.infer<typeof WebMarketSchema>;

/** `all` sums the venues that serve the series; the others select one. */
export const WebVenueFilterSchema = z.enum(['all', 'binance', 'bybit', 'okx']);
export type WebVenueFilter = z.infer<typeof WebVenueFilterSchema>;

export const WebLiquidationBucketSchema = z.enum(['1m', '15m', '1h']);
export type WebLiquidationBucket = z.infer<typeof WebLiquidationBucketSchema>;

/**
 * **Epoch SECONDS**, on every series in this file, because that is what the charting library
 * takes. One unit per wire (Tech Lead's ruling, IB-031): the single place it changes is the
 * dashboard's `series.adapter.ts`, which converts to milliseconds for `MetricPoint` — the
 * backtest type that means ms — and specs that conversion. Nobody should have to infer this
 * from a value, so every field below is named `time` and documented here.
 */
const TimeSec = z.number().int().nonnegative();

export const WebCandleSchema = z.object({
  /** Bar open, epoch seconds. */
  time: TimeSec,
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
  /** Taker-buy base volume, when the row has it; the CVD pane needs it and older rows lack it. */
  takerBuyVolume: z.number().nonnegative().nullable().optional(),
});
export type WebCandle = z.infer<typeof WebCandleSchema>;

export const WebCandlesResponseSchema = z.object({
  venue: z.string(),
  market: WebMarketSchema,
  symbol: z.string(),
  timeframe: WebTimeframeSchema,
  candles: z.array(WebCandleSchema),
  /** True when the server downsampled; the client says so rather than implying full grain. */
  downsampled: z.boolean(),
});
export type WebCandlesResponse = z.infer<typeof WebCandlesResponseSchema>;

/**
 * Settled funding is a step (it holds until the next settlement); predicted is a line sampled
 * per minute. They are different shapes and are never merged into one series.
 */
/** `time` is epoch seconds (see TimeSec). */
export const WebFundingPointSchema = z.object({ time: TimeSec, rate: z.number() });
export type WebFundingPoint = z.infer<typeof WebFundingPointSchema>;

export const WebFundingResponseSchema = z.object({
  symbol: z.string(),
  settled: z.array(z.object({ venue: z.string(), points: z.array(WebFundingPointSchema) })),
  predicted: z.array(WebFundingPointSchema),
  downsampled: z.boolean(),
});
export type WebFundingResponse = z.infer<typeof WebFundingResponseSchema>;

/**
 * WD-008 — read from the venue on demand, OI and long-short reach back only as far as the venue
 * keeps them (Binance `/futures/data/*`: about 30 days). Both optional, so the tape-backed routes
 * that never set them still parse:
 * - `coverageFrom` — the earliest instant the answer covers (epoch seconds); before it the venue
 *   has nothing, which is NOT the same as "nothing happened".
 * - `truncated` — the series starts later than the window asked for.
 */
const VenueCoverage = {
  coverageFrom: TimeSec.optional(),
  truncated: z.boolean().optional(),
};

export const WebLongShortPointSchema = z.object({ time: TimeSec, ratio: z.number() });
export const WebLongShortResponseSchema = z.object({
  symbol: z.string(),
  kind: z.enum(['global_account', 'top_account', 'top_position', 'taker']),
  points: z.array(WebLongShortPointSchema),
  downsampled: z.boolean(),
  ...VenueCoverage,
});
export type WebLongShortResponse = z.infer<typeof WebLongShortResponseSchema>;

/** Open interest: `value` in base units, `notional` in quote (null where the venue gives none). */
export const WebOpenInterestPointSchema = z.object({ time: TimeSec, value: z.number(), notional: z.number().nullable() });
export type WebOpenInterestPoint = z.infer<typeof WebOpenInterestPointSchema>;
export const WebOpenInterestResponseSchema = z.object({
  symbol: z.string(),
  venue: z.string(),
  points: z.array(WebOpenInterestPointSchema),
  downsampled: z.boolean(),
  ...VenueCoverage,
});
export type WebOpenInterestResponse = z.infer<typeof WebOpenInterestResponseSchema>;

/**
 * One bucket of liquidations, split by the side that was LIQUIDATED (§3.3) — the histogram is
 * two-colour and the sides must never be summed into one bar.
 */
export const WebLiquidationBarSchema = z.object({
  /** Bucket start, epoch seconds. */
  time: TimeSec,
  /** Notional of longs liquidated in the bucket. */
  long: z.number().nonnegative(),
  short: z.number().nonnegative(),
  events: z.number().int().nonnegative(),
});
export type WebLiquidationBar = z.infer<typeof WebLiquidationBarSchema>;

export const WebLiquidationsResponseSchema = z.object({
  symbol: z.string(),
  bucket: WebLiquidationBucketSchema,
  venue: WebVenueFilterSchema,
  /**
   * IB-BUG-011 — the venues that actually contributed rows to `bars`.
   *
   * `venue` above is the FILTER the caller asked for; this is what the data delivered. They used
   * to be assumed equal, and were not: the query matched the caller's symbol string, so OKX rows
   * (stored as `BTC-USDT-SWAP`) never matched `BTCUSDT` and the response still said
   * `venue: 'all'`. A reader saw «все биржи» over 10 % of the money. Now the claim and the data
   * are separate fields, so the next time they disagree it is visible instead of implied.
   */
  venuesPresent: z.array(z.string()),
  bars: z.array(WebLiquidationBarSchema),
  /**
   * §12.2: Binance emits at most one forceOrder event per second per symbol, so these are
   * *visible* liquidations and undercount the real flow. The pane states it; the flag is here so
   * the client cannot forget to.
   */
  undercounted: z.boolean(),
  downsampled: z.boolean(),
});
export type WebLiquidationsResponse = z.infer<typeof WebLiquidationsResponseSchema>;

/**
 * IB-039 — one liquidation event for the price chart's markers (§12.5).
 *
 * Deliberately NOT `WebLiquidationBar`: a bar is a bucket of money over time, a marker is one
 * event at a price. The marker needs `price`, which a bucket cannot have. Since IB-068 the server
 * can group events per chart bar (VWAP price), keeping this shape so a consumer merging events by
 * time needs no change.
 */
export const WebLiquidationEventSchema = z.object({
  time: TimeSec,
  /** The side that was LIQUIDATED (§3.3), not the side of the filling order. */
  side: z.enum(['long', 'short']),
  usd: z.number().nonnegative(),
  price: z.number(),
  venue: z.string(),
  /**
   * IB-068: present when the server grouped the window per bar (`tf` given). The row is then
   * one (bar start, side, venue): `time` is the bar's open, `usd` the sum, `price` the VWAP,
   * `count` how many events it stands for and `maxUsd` the largest of them. Absent means one event.
   */
  count: z.number().int().positive().optional(),
  maxUsd: z.number().nonnegative().optional(),
});
export type WebLiquidationEvent = z.infer<typeof WebLiquidationEventSchema>;

/** The most events one call will return before it refuses the range instead (§12.5). */
export const WEB_MAX_LIQUIDATION_EVENTS = 2_000;

export const WebLiquidationEventsResponseSchema = z.object({
  symbol: z.string(),
  minUsd: z.number().nonnegative(),
  events: z.array(WebLiquidationEventSchema),
  /**
   * IB-BUG-011: the venues that actually contributed, derived from the rows. The instrument
   * page labels the markers from THIS, never from a filter it sent — that is the whole lesson
   * of the panel that said «все биржи» over one venue's money.
   */
  venuesPresent: z.array(z.string()),
  /** §12.2: Binance publishes at most one forceOrder per second per symbol. */
  undercounted: z.boolean(),
});
export type WebLiquidationEventsResponse = z.infer<typeof WebLiquidationEventsResponseSchema>;

export const WebTopLiquidationSchema = z.object({
  time: TimeSec,
  venue: z.string(),
  side: z.enum(['long', 'short']),
  price: z.number(),
  qty: z.number(),
  notional: z.number(),
});
export type WebTopLiquidation = z.infer<typeof WebTopLiquidationSchema>;


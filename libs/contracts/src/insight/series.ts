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

/** Epoch seconds, as the charting library wants them. */
const TimeSec = z.number().int().nonnegative();

export const WebCandleSchema = z.object({
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
export const WebFundingPointSchema = z.object({ time: TimeSec, rate: z.number() });
export type WebFundingPoint = z.infer<typeof WebFundingPointSchema>;

export const WebFundingResponseSchema = z.object({
  symbol: z.string(),
  settled: z.array(z.object({ venue: z.string(), points: z.array(WebFundingPointSchema) })),
  predicted: z.array(WebFundingPointSchema),
  downsampled: z.boolean(),
});
export type WebFundingResponse = z.infer<typeof WebFundingResponseSchema>;

export const WebLongShortPointSchema = z.object({ time: TimeSec, ratio: z.number() });
export const WebLongShortResponseSchema = z.object({
  symbol: z.string(),
  kind: z.enum(['global_account', 'top_account', 'top_position', 'taker']),
  points: z.array(WebLongShortPointSchema),
  downsampled: z.boolean(),
});
export type WebLongShortResponse = z.infer<typeof WebLongShortResponseSchema>;

/**
 * One bucket of liquidations, split by the side that was LIQUIDATED (§3.3) — the histogram is
 * two-colour and the sides must never be summed into one bar.
 */
export const WebLiquidationBarSchema = z.object({
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

export const WebTopLiquidationSchema = z.object({
  time: TimeSec,
  venue: z.string(),
  side: z.enum(['long', 'short']),
  price: z.number(),
  qty: z.number(),
  notional: z.number(),
});
export type WebTopLiquidation = z.infer<typeof WebTopLiquidationSchema>;


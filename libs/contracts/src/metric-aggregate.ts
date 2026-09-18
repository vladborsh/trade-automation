import { z } from 'zod';
import { InstrumentIdSchema, VenueSchema } from './instrument';
import { MetricKindSchema, MetricOhlcSchema, MetricUnitSchema } from './metric';
import { TimeframeSchema } from './timeframe';

/*
 * architecture/aggregate-oi.md — one metric summed across venues (open interest across Binance
 * USDⓈ-M + Bybit linear + Hyperliquid). Contract only; the composition rule
 * (`aggregateObservations`) is implemented and unit-tested next to this file (SE-AG3).
 */

/**
 * aggregate-oi.md §3 — a series a metric adapter can fetch that is NOT a chart instrument (no
 * candles, not in instruments.yaml): Bybit and Hyperliquid legs of an aggregate. `id` has the
 * InstrumentId shape so MetricStore keys, MetricCache and health reuse it unchanged. An
 * `Instrument` satisfies this structurally, so the Binance leg is simply the chart instrument.
 */
export const MetricSourceSchema = z.object({
  id: InstrumentIdSchema,
  venue: VenueSchema,
  symbol: z.string().min(1),
  quoteCurrency: z.string().min(1),
});
export type MetricSource = z.infer<typeof MetricSourceSchema>;

/**
 * aggregate-oi.md §2 — the counting convention, a named setting, never a buried constant.
 * 'one-sided': every leg counts each open contract once (Binance `sumOpenInterest`, Bybit
 *   `singleOpenInterest`, Hyperliquid `openInterest`) — the internally consistent sum. DEFAULT.
 * 'as-published': every leg at the figure the venue headlines, i.e. Bybit's legacy two-sided
 *   `openInterest` (exactly 2 × single) — what CoinGlass/CoinGecko (and, inferred, Coinalyze)
 *   print. Reads ~14 % higher for BTC today, and mixes two conventions in one sum.
 */
export const CountingConventionSchema = z.enum(['one-sided', 'as-published']);
export type CountingConvention = z.infer<typeof CountingConventionSchema>;

/**
 * aggregate-oi.md §2 — how many sides each venue's HEADLINE open-interest figure counts. Stored
 * observations are always one-sided; under 'as-published' a leg is multiplied by this factor.
 * Bybit: docs ("the sum of both sides" vs "the single side") + ratio exactly 2.0000, verified
 * 2026-09-18. Binance / Hyperliquid: one-sided by arithmetic agreement with third parties.
 */
export const PUBLISHED_OI_SIDES: Readonly<Record<z.infer<typeof VenueSchema>, 1 | 2>> = {
  binance: 1,
  capitalcom: 1, // no open interest; present only to keep the record total
  bybit: 2,
  hyperliquid: 1,
};

/** aggregate-oi.md §3 — `config/metric-aggregates.yaml` entry. */
export const MetricAggregateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    displayName: z.string().min(1),
    metric: MetricKindSchema,
    countingConvention: CountingConventionSchema.default('one-sided'),
    members: z.array(MetricSourceSchema).min(2),
  })
  .superRefine((a, ctx) => {
    if (new Set(a.members.map((m) => m.id)).size !== a.members.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate aggregate member' });
  });
export type MetricAggregate = z.infer<typeof MetricAggregateSchema>;

/** One leg of an aggregate point, at the point's closing sample, AFTER the convention factor. */
export const AggregateMemberValueSchema = z.object({
  source: InstrumentIdSchema,
  value: z.number().nonnegative(),
  notional: z.number().nonnegative().optional(),
});
export type AggregateMemberValue = z.infer<typeof AggregateMemberValueSchema>;

/**
 * aggregate-oi.md §1 — one bucket of an aggregate series. Same OHLC semantics as MetricPoint
 * (chart-layouts §11.2), with the coverage rule on top:
 * - `coverage`: member ids summed in this bucket (sorted). Every sample in the bucket has
 *   exactly this coverage — a bucket never mixes coverage sets (§1 rule C4).
 * - `complete`: coverage === every configured member.
 * - `coverageStart`: first bucket of a coverage epoch; its `open` is its own first sample,
 *   never the previous bucket's close, so a coverage change can never draw a candle body.
 * - `unit` is 'base' (every leg is base-asset units); `notional` is USD (USDT/USDC legs
 *   summed at par, §4).
 */
export const AggregateMetricPointSchema = z.object({
  aggregate: z.string().min(1),
  metric: MetricKindSchema,
  timeframe: TimeframeSchema,
  time: z.number().int().nonnegative(),
  unit: MetricUnitSchema,
  value: z.number().nonnegative(),
  ohlc: MetricOhlcSchema,
  notional: z.number().nonnegative().optional(),
  notionalOhlc: MetricOhlcSchema.optional(),
  samples: z.number().int().positive(),
  coverage: z.array(InstrumentIdSchema).min(1),
  complete: z.boolean(),
  coverageStart: z.boolean(),
  members: z.array(AggregateMemberValueSchema),
});
export type AggregateMetricPoint = z.infer<typeof AggregateMetricPointSchema>;

/** aggregate-oi.md §5 — GET /api/metric-aggregates/points. */
export const AggregatePointsQuerySchema = z.object({
  aggregate: z.string().min(1),
  timeframe: TimeframeSchema,
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(5000).default(1500),
});
export type AggregatePointsQuery = z.infer<typeof AggregatePointsQuerySchema>;

/** Envelope, not a bare array: the client must know the convention and members in force. */
export const AggregatePointsResponseSchema = z.object({
  aggregate: MetricAggregateSchema,
  points: z.array(AggregateMetricPointSchema),
});
export type AggregatePointsResponse = z.infer<typeof AggregatePointsResponseSchema>;

/** aggregate-oi.md §5 — GET /api/metric-aggregates (definitions). */
export const MetricAggregatesResponseSchema = z.array(MetricAggregateSchema);
export type MetricAggregatesResponse = z.infer<typeof MetricAggregatesResponseSchema>;

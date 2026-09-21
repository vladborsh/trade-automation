import { z } from 'zod';
import { TimeframeSchema } from './timeframe';
import { InstrumentIdSchema } from './instrument';

/**
 * architecture/live-signal-server.md §11.1 — required label on every strategy, signal and
 * indicator point. 'demo' proves the plumbing (example-cross), never a strategy of this
 * project. 'research' is a faithful port of a strategy that has not passed its pre-registered
 * test — visualization only, may never emit `kind: 'entry'`. 'live' has passed its test and has
 * an Architect ship ruling on record. The tier is declared in code, never in strategies.yaml —
 * promotion is a code change gated on an Architect ruling.
 */
export const StrategyTierSchema = z.enum(['demo', 'research', 'live']);
export type StrategyTier = z.infer<typeof StrategyTierSchema>;

/**
 * architecture/live-signal-server.md §11.3 — one indicator series a strategy can emit points for.
 *
 * T-028 (provisional, pending Architect): `scale` also accepts `'pane'`, a series drawn in its own
 * pane below the price pane (RSI, MACD, Stochastic), with an optional fixed `range` and reference
 * `levels`. Additive: every existing spec is `'price'` and parses unchanged; live strategies keep
 * emitting `'price'`.
 */
export const IndicatorSeriesSpecSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  scale: z.enum(['price', 'pane']),
  range: z.object({ min: z.number(), max: z.number() }).optional(),
  levels: z.array(z.number()).optional(),
  keys: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      color: z.string().optional(),
      style: z.enum(['solid', 'dashed']).optional(),
    }),
  ),
});
export type IndicatorSeriesSpec = z.infer<typeof IndicatorSeriesSpecSchema>;

/** architecture/live-signal-server.md §4.4, §11.2 — strategy plug-in requirements, shared with config validation. */
export const StrategyRequirementsSchema = z.object({
  instruments: z.array(InstrumentIdSchema),
  timeframe: TimeframeSchema,
  auxTimeframes: z.array(TimeframeSchema).optional(),
  warmupBars: z.record(TimeframeSchema, z.number().int().nonnegative()),
  /**
   * Optional: when present, the runner's isWarm gate uses minBars[tf] instead of
   * warmupBars[tf]. warmupBars keeps its cache-sizing role unchanged. See
   * architecture/vwap-band-reversal-plugin.md §4: a session-anchored strategy's readiness is
   * not a fixed bar count.
   */
  minBars: z.record(TimeframeSchema, z.number().int().nonnegative()).optional(),
  indicators: z.array(IndicatorSeriesSpecSchema).optional(),
});
export type StrategyRequirements = z.infer<typeof StrategyRequirementsSchema>;

/** architecture/live-signal-server.md §11.3 — a recomputable, non-persisted indicator sample. */
export const IndicatorPointSchema = z.object({
  strategyId: z.string().min(1),
  instrument: InstrumentIdSchema,
  timeframe: TimeframeSchema,
  tier: StrategyTierSchema,
  seriesId: z.string().min(1),
  time: z.number().int().nonnegative(), // openTime of the evaluated bar
  values: z.record(z.string(), z.number().nullable()),
});
export type IndicatorPoint = z.infer<typeof IndicatorPointSchema>;

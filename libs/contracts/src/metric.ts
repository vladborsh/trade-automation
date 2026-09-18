import { z } from 'zod';
import { InstrumentIdSchema } from './instrument';
import { TIMEFRAME_MS, Timeframe, TimeframeSchema } from './timeframe';

/** architecture/chart-layouts.md §4 — non-OHLCV series about an instrument. */
export const MetricKindSchema = z.enum(['openInterest']); // extensible: 'fundingRate', 'longShortRatio', …
export type MetricKind = z.infer<typeof MetricKindSchema>;

/**
 * architecture/chart-layouts.md §11.1 — the unit of `MetricObservation.value`, written by every
 * mapper: Binance USDⓈ-M reports base-asset units ('base'); a COIN-M mapper would report
 * 'contracts'. Describes `value` only — `notional` is always in the instrument's quoteCurrency.
 */
export const MetricUnitSchema = z.enum(['base', 'quote', 'contracts']);
export type MetricUnit = z.infer<typeof MetricUnitSchema>;

/**
 * Where `notional` came from: 'venue' = the venue's own published figure
 * (`sumOpenInterestValue`); 'derived' = `value × price` computed by us. Present iff `notional` is.
 */
export const NotionalBasisSchema = z.enum(['venue', 'derived']);
export type NotionalBasis = z.infer<typeof NotionalBasisSchema>;

/**
 * One raw observation as ingested and stored. `time` is the venue's stamp
 * (openInterestHist.timestamp, or /fapi/v1/openInterest.time), ms UTC — never
 * the local clock (same rule as Candle.openTime, base §3.3).
 * `value`: for openInterest, contracts outstanding, in `unit` (Binance USDⓈ-M
 * `sumOpenInterest` / `openInterest` → 'base'). `notional`: `value` in the instrument's
 * quoteCurrency (`sumOpenInterestValue`, basis 'venue') — present on history rows, absent on
 * live snapshots.
 */
export const MetricObservationSchema = z.object({
  metric: MetricKindSchema,
  instrument: InstrumentIdSchema,
  time: z.number().int().nonnegative(),
  value: z.number().nonnegative(),
  unit: MetricUnitSchema,
  notional: z.number().nonnegative().optional(),
  notionalBasis: NotionalBasisSchema.optional(),
});
export type MetricObservation = z.infer<typeof MetricObservationSchema>;

/**
 * What the wire carries: observations bucketed to a timeframe so a metric
 * panel shares the candle panels' time grid. `time` = bucket openTime
 * (floor to TIMEFRAME_MS[timeframe]); `value`/`unit`/`notional`/`notionalBasis` = the LAST observation
 * in the bucket. Identity is (metric, instrument, timeframe, time): a newer
 * point with the same `time` REPLACES (the forming-bar rule, base §5.3 step 3).
 */
export const MetricPointSchema = MetricObservationSchema.extend({
  timeframe: TimeframeSchema,
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;

export function metricKey(metric: string, instrument: string, timeframe: string, time: number): string {
  return `${metric}|${instrument}|${timeframe}|${time}`;
}

/** Pure, unit-tested: observations (ascending) → points for `tf`, last-in-bucket. */
export function bucketObservations(obs: readonly MetricObservation[], tf: Timeframe): MetricPoint[] {
  const bucketMs = TIMEFRAME_MS[tf];
  const buckets = new Map<number, MetricObservation>();
  for (const o of obs) {
    const bucketTime = Math.floor(o.time / bucketMs) * bucketMs;
    buckets.set(bucketTime, o); // last-in-bucket wins; obs is ascending
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([time, o]) => ({
      metric: o.metric,
      instrument: o.instrument,
      time,
      value: o.value,
      unit: o.unit,
      notional: o.notional,
      notionalBasis: o.notionalBasis,
      timeframe: tf,
    }));
}

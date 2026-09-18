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
 * quoteCurrency: on history rows the venue's `sumOpenInterestValue` (basis 'venue'); on live
 * snapshots `value` × the venue's mark price at the snapshot (basis 'derived', §11.1), absent
 * when no fresh mark price was available.
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

/** architecture/chart-layouts.md §11.2 — OHLC of one bucket of a metric. */
export const MetricOhlcSchema = z.object({
  open: z.number().nonnegative(),
  high: z.number().nonnegative(),
  low: z.number().nonnegative(),
  close: z.number().nonnegative(),
});
export type MetricOhlc = z.infer<typeof MetricOhlcSchema>;

/**
 * What the wire carries: observations bucketed to a timeframe so a metric panel shares the
 * candle panels' time grid (architecture/chart-layouts.md §11.2). `time` = bucket openTime
 * (floor to TIMEFRAME_MS[timeframe]). `value` = `ohlc.close` (last-in-bucket, back-compat);
 * `notional` = `notionalOhlc.close`, over the samples that carry a notional (absent if none);
 * `unit` of the closing sample, `notionalBasis` of the closing notional sample. `samples` = how
 * many 5 m-grain samples built the bucket. Identity is (metric, instrument, timeframe, time):
 * a newer point with the same `time` REPLACES (the forming-bar rule, base §5.3 step 3).
 */
export const MetricPointSchema = z.object({
  metric: MetricKindSchema,
  instrument: InstrumentIdSchema,
  timeframe: TimeframeSchema,
  time: z.number().int().nonnegative(),
  unit: MetricUnitSchema,
  value: z.number().nonnegative(),
  ohlc: MetricOhlcSchema,
  notional: z.number().nonnegative().optional(),
  notionalOhlc: MetricOhlcSchema.optional(),
  notionalBasis: NotionalBasisSchema.optional(),
  samples: z.number().int().positive(),
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;

export function metricKey(metric: string, instrument: string, timeframe: string, time: number): string {
  return `${metric}|${instrument}|${timeframe}|${time}`;
}

/**
 * §11.2 rule 1 — the sample grain: history is one reading per 5 m, so every bucket is built
 * from one sample per 5 m sub-bucket (last-in-sub-bucket); the 1 m timeframe, whose bucket is
 * finer than that, keeps its own 1 m grain.
 */
const SAMPLE_GRAIN_MS = TIMEFRAME_MS['5m'];

function ohlcOf(open: number | undefined, values: readonly number[]): MetricOhlc {
  const all = open === undefined ? values : [open, ...values];
  return {
    open: all[0],
    high: Math.max(...all),
    low: Math.min(...all),
    close: values[values.length - 1],
  };
}

/**
 * Pure, unit-tested (architecture/chart-layouts.md §11.2): observations (ascending) → one point
 * per `tf` bucket. Rules: (1) reduce to one sample per 5 m sub-bucket (1 m tf: per 1 m);
 * (2) open = the immediately preceding bucket's close when that bucket is in the input, else the
 * first sample; high/low over {open} ∪ samples; close = last sample. The notional OHLC is built
 * the same way over the samples that carry a notional.
 */
export function bucketObservations(obs: readonly MetricObservation[], tf: Timeframe): MetricPoint[] {
  const bucketMs = TIMEFRAME_MS[tf];
  const grainMs = Math.min(bucketMs, SAMPLE_GRAIN_MS);

  // Rule 1: last-in-sub-bucket. `obs` is ascending, so a later observation overwrites.
  const grained = new Map<number, MetricObservation>();
  for (const o of obs) grained.set(Math.floor(o.time / grainMs) * grainMs, o);

  const buckets = new Map<number, MetricObservation[]>();
  for (const [grainTime, o] of Array.from(grained.entries()).sort(([a], [b]) => a - b)) {
    const bucketTime = Math.floor(grainTime / bucketMs) * bucketMs;
    const samples = buckets.get(bucketTime);
    if (samples) samples.push(o);
    else buckets.set(bucketTime, [o]);
  }

  const points: MetricPoint[] = [];
  let prev: MetricPoint | undefined;
  for (const [time, samples] of buckets) {
    const adjacent = prev !== undefined && prev.time === time - bucketMs ? prev : undefined;
    const last = samples[samples.length - 1];
    const point: MetricPoint = {
      metric: last.metric,
      instrument: last.instrument,
      timeframe: tf,
      time,
      unit: last.unit,
      value: last.value,
      ohlc: ohlcOf(adjacent?.ohlc.close, samples.map((s) => s.value)),
      samples: samples.length,
    };
    const withNotional = samples.filter((s) => s.notional !== undefined);
    if (withNotional.length > 0) {
      const closing = withNotional[withNotional.length - 1];
      point.notionalOhlc = ohlcOf(adjacent?.notionalOhlc?.close, withNotional.map((s) => s.notional as number));
      point.notional = closing.notional;
      if (closing.notionalBasis !== undefined) point.notionalBasis = closing.notionalBasis;
    }
    points.push(point);
    prev = point;
  }
  return points;
}

import { z } from 'zod';
import { InstrumentIdSchema, VenueSchema } from './instrument';
import {
  MetricKindSchema,
  MetricObservation,
  MetricOhlc,
  MetricOhlcSchema,
  MetricUnit,
  MetricUnitSchema,
} from './metric';
import { TIMEFRAME_MS, Timeframe, TimeframeSchema } from './timeframe';

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

/**
 * aggregate-oi.md §1 rule C3 — a run of identical coverage shorter than this many samples, whose
 * coverage is a strict subset of an adjacent run's, is a missed poll, not an outage: dropped.
 */
export const AGGREGATE_MIN_RUN_SAMPLES = 3;

/** §1 C1 — the same sample grain as `bucketObservations` (chart-layouts §11.2 rule 1). */
const AGGREGATE_GRAIN_MS = TIMEFRAME_MS['5m'];

/** §1 C1 — the grain every member is reduced to before summing: min(tf, 5 m). */
export function aggregateGrainMs(tf: Timeframe): number {
  return Math.min(TIMEFRAME_MS[tf], AGGREGATE_GRAIN_MS);
}

/** One aggregate sample: one grain slot, summed over the members present in it (§1 C2). */
interface AggregateSample {
  time: number;
  coverageKey: string;
  coverage: MetricSource['id'][];
  unit: MetricUnit;
  value: number;
  notional: number | undefined;
  members: AggregateMemberValue[];
}

function ohlcFrom(open: number | undefined, values: readonly number[]): MetricOhlc {
  const all = open === undefined ? values : [open, ...values];
  return { open: all[0], high: Math.max(...all), low: Math.min(...all), close: values[values.length - 1] };
}

/** §1 C1 + C2 — per-member last-in-slot reduction, then the per-slot sum over present members. */
function sampleSlots(
  members: readonly { source: MetricSource; observations: readonly MetricObservation[] }[],
  convention: CountingConvention,
  grainMs: number,
): AggregateSample[] {
  const bySlot = new Map<number, { source: MetricSource; o: MetricObservation }[]>();
  for (const { source, observations } of members) {
    // C1: last-in-slot by `time`, whatever order the member's observations arrived in.
    const slots = new Map<number, MetricObservation>();
    for (const o of [...observations].sort((a, b) => a.time - b.time)) {
      slots.set(Math.floor(o.time / grainMs) * grainMs, o);
    }
    for (const [slot, o] of slots) {
      const legs = bySlot.get(slot);
      if (legs) legs.push({ source, o });
      else bySlot.set(slot, [{ source, o }]);
    }
  }

  const samples: AggregateSample[] = [];
  for (const slot of Array.from(bySlot.keys()).sort((a, b) => a - b)) {
    const legs = (bySlot.get(slot) ?? []).sort((a, b) => (a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0));
    const memberValues: AggregateMemberValue[] = legs.map(({ source, o }) => {
      // §2 — stored legs are one-sided; 'as-published' restores each venue's headline count.
      const factor = convention === 'as-published' ? PUBLISHED_OI_SIDES[source.venue] : 1;
      const leg: AggregateMemberValue = { source: source.id, value: o.value * factor };
      if (o.notional !== undefined) leg.notional = o.notional * factor;
      return leg;
    });
    const coverage = memberValues.map((m) => m.source);
    samples.push({
      time: slot,
      coverageKey: coverage.join(','),
      coverage,
      unit: legs[0].o.unit,
      value: memberValues.reduce((sum, m) => sum + m.value, 0),
      // C2 — a USD sum only when every present leg has one (§11.1: a gap, never a partial sum).
      notional: memberValues.every((m) => m.notional !== undefined)
        ? memberValues.reduce((sum, m) => sum + (m.notional as number), 0)
        : undefined,
      members: memberValues,
    });
  }
  return samples;
}

function isStrictSubset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length >= b.length) return false;
  const inB = new Set(b);
  return a.every((id) => inB.has(id));
}

/**
 * §1 C3 — split into runs of identical coverage and drop every run shorter than K whose
 * coverage is a strict subset of an adjacent run's. Decided on the original runs (not
 * iteratively). The right edge needs no special case: the last run has only a left neighbour,
 * so a short subset tail (a forming slot some venues have not reported yet) is withheld until it
 * reaches K samples (an outage → partial epoch) or a fuller slot supersedes it.
 */
function dropBlips(samples: readonly AggregateSample[]): AggregateSample[] {
  const runs: AggregateSample[][] = [];
  for (const s of samples) {
    const run = runs[runs.length - 1];
    if (run && run[0].coverageKey === s.coverageKey) run.push(s);
    else runs.push([s]);
  }
  return runs
    .filter((run, i) => {
      if (run.length >= AGGREGATE_MIN_RUN_SAMPLES) return true;
      const neighbours = [runs[i - 1], runs[i + 1]].filter((r): r is AggregateSample[] => r !== undefined);
      return !neighbours.some((n) => isStrictSubset(run[0].coverage, n[0].coverage));
    })
    .flat();
}

/**
 * Pure, unit-tested (architecture/aggregate-oi.md §1, rules C1–C6): each member's observations
 * (any order) → one aggregate point per `tf` bucket.
 * - C1: per member, one sample per grain slot (grain = min(tf, 5 m)), last-in-slot.
 * - C2: a slot sums the members present in it (× PUBLISHED_OI_SIDES[venue] under 'as-published');
 *   notional only if every present member has one; `coverage` = those ids, sorted.
 * - C3: short subset runs are dropped (never a dip); a short subset tail is withheld.
 * - C4: a bucket is built from the samples at its end that share the closing sample's coverage —
 *   the trailing stretch of the bucket back to the last coverage change (after C3), so a bucket
 *   never mixes coverage sets, not even two separate stretches of the same set. A bucket that
 *   lost earlier samples that way starts an epoch.
 * - C5: open = the previous bucket's close only if that bucket is adjacent, has the same
 *   coverage and this bucket lost nothing to C4; otherwise the bucket's own first sample and
 *   `coverageStart: true`. No candle body is ever drawn across a seam.
 * - C6: complete = coverage is every member passed in (the configured members, with or without
 *   observations).
 * `members[]` = the legs at the closing sample, after the convention factor.
 */
export function aggregateObservations(
  members: readonly { source: MetricSource; observations: readonly MetricObservation[] }[],
  convention: CountingConvention,
  tf: Timeframe,
  aggregateId: string,
): AggregateMetricPoint[] {
  const bucketMs = TIMEFRAME_MS[tf];
  const samples = dropBlips(sampleSlots(members, convention, aggregateGrainMs(tf)));
  const metric = members.flatMap((m) => m.observations)[0]?.metric;
  if (metric === undefined) return [];

  const buckets = new Map<number, AggregateSample[]>();
  for (const s of samples) {
    const time = Math.floor(s.time / bucketMs) * bucketMs;
    const list = buckets.get(time);
    if (list) list.push(s);
    else buckets.set(time, [s]);
  }

  const points: AggregateMetricPoint[] = [];
  let prev: AggregateMetricPoint | undefined;
  for (const [time, all] of buckets) {
    const closing = all[all.length - 1];
    // C4 — the trailing stretch sharing the closing sample's coverage.
    let first = all.length - 1;
    while (first > 0 && all[first - 1].coverageKey === closing.coverageKey) first--;
    const used = all.slice(first);

    const continues =
      first === 0 &&
      prev !== undefined &&
      prev.time === time - bucketMs &&
      prev.coverage.join(',') === closing.coverageKey;
    const carried = continues ? prev : undefined;

    const point: AggregateMetricPoint = {
      aggregate: aggregateId,
      metric,
      timeframe: tf,
      time,
      unit: closing.unit,
      value: closing.value,
      ohlc: ohlcFrom(carried?.ohlc.close, used.map((s) => s.value)),
      samples: used.length,
      coverage: closing.coverage,
      complete: closing.coverage.length === members.length,
      coverageStart: !continues,
      members: closing.members,
    };
    const withNotional = used.filter((s) => s.notional !== undefined);
    if (withNotional.length > 0) {
      point.notionalOhlc = ohlcFrom(carried?.notionalOhlc?.close, withNotional.map((s) => s.notional as number));
      point.notional = point.notionalOhlc.close;
    }
    points.push(point);
    prev = point;
  }
  return points;
}

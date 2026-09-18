import { Inject, Injectable } from '@nestjs/common';
import {
  AGGREGATE_MIN_RUN_SAMPLES,
  AggregateMetricPoint,
  InstrumentId,
  MetricAggregate,
  MetricKind,
  MetricObservation,
  TIMEFRAME_MS,
  Timeframe,
  aggregateGrainMs,
  aggregateObservations,
} from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { METRIC_STORE, MetricStore } from '../../storage/metric-store.port';
import { MetricCache } from './metric-cache.service';

/** aggregate-oi.md §5 / §6 — how old the latest 5 m aggregate point may be and still count as "now". */
const HEALTH_FRESHNESS_MS = 15 * 60_000;
const HEALTH_TIMEFRAME: Timeframe = '5m';

export interface AggregateHealth {
  id: string;
  coverageNow: InstrumentId[];
  complete: boolean;
}

/**
 * architecture/aggregate-oi.md §3.1, §5 — compose on read: each leg is stored as itself
 * (MetricCache / MetricStore) and summed here by the pure `aggregateObservations` (rules C1–C6).
 *
 * Look-behind: a bucket's points depend on its predecessor (C5 open) and on the runs around its
 * first samples (C3), so members are read from `firstBucket − tfMs − K·grain` and the lead
 * buckets are dropped — the same reason `/api/metrics` reads one bucket early. REST and WS both
 * go through `compose`, so the WS point for a bucket equals the REST point for it.
 */
@Injectable()
export class AggregateMetricsService {
  constructor(
    private readonly config: AppConfigService,
    private readonly cache: MetricCache,
    @Inject(METRIC_STORE) private readonly store: MetricStore,
  ) {}

  definitions(): MetricAggregate[] {
    return this.config.metricAggregates;
  }

  find(id: string): MetricAggregate | undefined {
    return this.config.metricAggregates.find((a) => a.id === id);
  }

  /** The aggregates `instrument` is a member leg of, for `metric`. */
  aggregatesWithMember(instrument: InstrumentId, metric: MetricKind): MetricAggregate[] {
    return this.config.metricAggregates.filter(
      (a) => a.metric === metric && a.members.some((m) => m.id === instrument),
    );
  }

  /** GET /api/metric-aggregates/points — cache-then-store per member, as MetricsController does. */
  async points(
    aggregate: MetricAggregate,
    tf: Timeframe,
    from: number,
    to: number,
    limit: number,
  ): Promise<AggregateMetricPoint[]> {
    const firstBucket = this.bucketStart(from, tf);
    const readFrom = Math.max(0, this.lookBehindFrom(firstBucket, tf));
    const legs = await Promise.all(
      aggregate.members.map(async (m) => this.readCacheThenStore(m.id, aggregate.metric, readFrom, to)),
    );
    const points = this.compose(aggregate, tf, legs).filter((p) => p.time >= firstBucket);
    return points.slice(Math.max(0, points.length - limit));
  }

  /**
   * WS — the bucket containing `time`, rebuilt from MetricCache alone; null when C3 withholds it
   * (e.g. the forming slot has Bybit's poll but not yet Hyperliquid's).
   */
  formingPoint(aggregate: MetricAggregate, tf: Timeframe, time: number): AggregateMetricPoint | null {
    const bucket = this.bucketStart(time, tf);
    const readFrom = this.lookBehindFrom(bucket, tf);
    // No upper bound: C3 judges a run by both neighbours, so the right one must be visible too.
    const legs = aggregate.members.map((m) =>
      this.cache.query(m.id, aggregate.metric, readFrom, Number.MAX_SAFE_INTEGER),
    );
    return this.compose(aggregate, tf, legs).find((p) => p.time === bucket) ?? null;
  }

  /** GET /api/health `aggregates[]` (aggregate-oi.md §5). */
  health(now: number): AggregateHealth[] {
    return this.config.metricAggregates.map((aggregate) => {
      const last = this.latestPoint(aggregate, now);
      const fresh = last !== undefined && last.time >= this.bucketStart(now, HEALTH_TIMEFRAME) - HEALTH_FRESHNESS_MS;
      return {
        id: aggregate.id,
        coverageNow: fresh ? last.coverage : [],
        complete: fresh ? last.complete : false,
      };
    });
  }

  private latestPoint(aggregate: MetricAggregate, now: number): AggregateMetricPoint | undefined {
    const readFrom = this.lookBehindFrom(this.bucketStart(now, HEALTH_TIMEFRAME) - HEALTH_FRESHNESS_MS, HEALTH_TIMEFRAME);
    const legs = aggregate.members.map((m) => this.cache.query(m.id, aggregate.metric, readFrom, now));
    return this.compose(aggregate, HEALTH_TIMEFRAME, legs).at(-1);
  }

  private compose(
    aggregate: MetricAggregate,
    tf: Timeframe,
    legs: readonly MetricObservation[][],
  ): AggregateMetricPoint[] {
    return aggregateObservations(
      aggregate.members.map((source, i) => ({ source, observations: legs[i] })),
      aggregate.countingConvention,
      tf,
      aggregate.id,
    );
  }

  private bucketStart(time: number, tf: Timeframe): number {
    const tfMs = TIMEFRAME_MS[tf];
    return Math.floor(time / tfMs) * tfMs;
  }

  /** Lead bucket (C5) + K grain slots (C3 look-behind). */
  private lookBehindFrom(firstBucket: number, tf: Timeframe): number {
    return firstBucket - TIMEFRAME_MS[tf] - AGGREGATE_MIN_RUN_SAMPLES * aggregateGrainMs(tf);
  }

  private async readCacheThenStore(
    instrument: InstrumentId,
    metric: MetricKind,
    from: number,
    to: number,
  ): Promise<MetricObservation[]> {
    const cached = this.cache.query(instrument, metric, from, to);
    if (cached.length === 0) return this.store.query(instrument, metric, from, to);
    const storeTo = cached[0].time - 1;
    const older = from <= storeTo ? await this.store.query(instrument, metric, from, storeTo) : [];
    return [...older, ...cached];
  }
}

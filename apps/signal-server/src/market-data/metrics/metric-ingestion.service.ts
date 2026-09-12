import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subscription } from 'rxjs';
import { Instrument, InstrumentId, MetricKind, Venue } from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { METRIC_STORE, MetricStore } from '../../storage/metric-store.port';
import { MetricWriteBuffer } from '../../storage/metric-write-buffer.service';
import { MetricsService } from '../../observability/metrics.service';
import { BarClock } from '../bar-clock.service';
import { MetricCache } from './metric-cache.service';
import { MetricAdapter } from './metric-adapter.port';
import { MetricEvents, MetricObservedEvent } from './metric.events';
import { buildMetricAdapters } from '../metric-adapters.provider';

// Matches MetricCache's default depth (metric-cache.service.ts) and the confirmed Binance
// openInterestHist retention (binance-metrics.adapter.ts) — no point asking the venue for
// more history than either can hold or serve.
const DEFAULT_CACHE_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
// architecture/chart-layouts.md §4.4 — spreads polls across a boundary tick instead of firing
// every pair at exactly the same millisecond.
const MAX_POLL_JITTER_MS = 2000;

interface MetricPairStatus {
  instrument: InstrumentId;
  metric: MetricKind;
  lastObservationAge: number | null;
}

/**
 * architecture/chart-layouts.md §4.4 — wires MetricAdapter(s) to MetricCache, the event bus and
 * MetricWriteBuffer for every (instrument, metric) pair demanded by layouts.yaml's metric
 * panels. Boot order mirrors IngestionService (market-data/ingestion.service.ts) exactly:
 * storage -> REST backfill tail -> poll loop, "so a restart never leaves a hole." Polling rides
 * the existing BarClock 1m tick (base §4.6) rather than a second timer, gated by
 * METRIC_POLL_INTERVAL_MS so the cadence is a multiple of ticks, not hard-coded to one.
 */
@Injectable()
export class MetricIngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MetricIngestionService.name);
  private readonly subscriptions: Subscription[] = [];
  private adapters = new Map<Venue, MetricAdapter>();
  private readonly lastPolledAt = new Map<string, number>();
  private readonly lastObservationAt = new Map<string, number>();

  constructor(
    private readonly config: AppConfigService,
    private readonly cache: MetricCache,
    private readonly events: EventEmitter2,
    private readonly writeBuffer: MetricWriteBuffer,
    private readonly barClock: BarClock,
    private readonly appMetrics: MetricsService,
    @Inject(METRIC_STORE) private readonly store: MetricStore,
  ) {}

  private pairKey(instrument: InstrumentId, metric: MetricKind): string {
    return `${instrument}|${metric}`;
  }

  /**
   * architecture/chart-layouts.md §2.2, §4.4 — "the set of (instrument, metric) pairs
   * referenced by metric panels is also what drives metric ingestion at boot; there is no
   * second place to list 'which metrics to ingest'." AppConfigService already boot-fails on a
   * dangling instrument id, so every panel here resolves.
   */
  private metricPairs(): { instrument: Instrument; metric: MetricKind }[] {
    const byId = new Map(this.config.instruments.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const pairs: { instrument: Instrument; metric: MetricKind }[] = [];
    for (const layout of this.config.layouts) {
      for (const panel of layout.panels) {
        if (panel.kind !== 'metric' || !panel.metric) continue;
        const key = this.pairKey(panel.instrument, panel.metric);
        if (seen.has(key)) continue;
        seen.add(key);
        const instrument = byId.get(panel.instrument);
        if (!instrument) continue;
        pairs.push({ instrument, metric: panel.metric });
      }
    }
    return pairs;
  }

  async onApplicationBootstrap(): Promise<void> {
    this.adapters = buildMetricAdapters(this.config);

    for (const { instrument, metric } of this.metricPairs()) {
      const adapter = this.adapters.get(instrument.venue);
      if (!adapter || !adapter.supports.includes(metric)) {
        this.logger.warn(
          `No metric adapter for venue ${instrument.venue} supporting ${metric}; ${instrument.id}/${metric} stays down`,
        );
        continue;
      }
      await this.warmUp(instrument, metric, adapter);
      this.startPolling(instrument, metric, adapter);
    }
  }

  private async warmUp(instrument: Instrument, metric: MetricKind, adapter: MetricAdapter): Promise<void> {
    const now = Date.now();
    const latestStored = await this.store.latestTime(instrument.id, metric);
    const fromStorage = await this.store.query(
      instrument.id,
      metric,
      now - DEFAULT_CACHE_LOOKBACK_MS,
      latestStored ?? now,
    );
    for (const o of fromStorage) this.cache.upsert(o);

    const backfillFrom = latestStored !== null ? latestStored + 1 : now - DEFAULT_CACHE_LOOKBACK_MS;
    if (backfillFrom > now) return;

    try {
      const backfilled = await adapter.fetchObservations(instrument, metric, backfillFrom, now);
      for (const o of backfilled) {
        this.cache.upsert(o);
        this.lastObservationAt.set(this.pairKey(instrument.id, metric), o.time);
        this.events.emit(MetricEvents.MetricObserved, new MetricObservedEvent(o));
        void this.writeBuffer.add(o);
      }
      this.logger.log(`Warm-up backfilled ${backfilled.length} observations for ${instrument.id}/${metric}`);
    } catch (err) {
      this.logger.error(
        `Metric warm-up backfill failed for ${instrument.id}/${metric}: ${(err as Error).message}`,
      );
    }
  }

  private startPolling(instrument: Instrument, metric: MetricKind, adapter: MetricAdapter): void {
    const key = this.pairKey(instrument.id, metric);
    const sub = this.barClock.tick$.subscribe(() => void this.maybePoll(instrument, metric, adapter, key));
    this.subscriptions.push(sub);
  }

  private async maybePoll(
    instrument: Instrument,
    metric: MetricKind,
    adapter: MetricAdapter,
    key: string,
  ): Promise<void> {
    const intervalMs = this.config.env.get('METRIC_POLL_INTERVAL_MS');
    const now = Date.now();
    const last = this.lastPolledAt.get(key) ?? 0;
    if (now - last < intervalMs) return;
    this.lastPolledAt.set(key, now);

    const jitterMs = Math.floor(Math.random() * MAX_POLL_JITTER_MS);
    if (jitterMs > 0) await new Promise((resolve) => setTimeout(resolve, jitterMs));

    try {
      const observation = await adapter.fetchLatest(instrument, metric);
      this.cache.upsert(observation);
      this.lastObservationAt.set(key, observation.time);
      void this.writeBuffer.add(observation);
      this.events.emit(MetricEvents.MetricObserved, new MetricObservedEvent(observation));
      this.appMetrics.metricObservationsTotal.inc({ instrument: instrument.id, metric });
    } catch (err) {
      this.logger.error(`Metric poll failed for ${key}: ${(err as Error).message}`);
      this.appMetrics.metricPollErrorsTotal.inc();
    }
  }

  /** architecture/chart-layouts.md §4.4 — backs `GET /api/health`'s `metrics` field. */
  status(): MetricPairStatus[] {
    const now = Date.now();
    return this.metricPairs().map(({ instrument, metric }) => {
      const lastTime = this.lastObservationAt.get(this.pairKey(instrument.id, metric)) ?? null;
      return {
        instrument: instrument.id,
        metric,
        lastObservationAge: lastTime !== null ? now - lastTime : null,
      };
    });
  }

  onModuleDestroy(): void {
    for (const sub of this.subscriptions) sub.unsubscribe();
  }
}

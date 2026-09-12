import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { MetricObservation } from '@trade-automation/contracts';
import { MetricsService } from '../observability/metrics.service';
import { METRIC_STORE, MetricStore } from './metric-store.port';

const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_MAX_OBSERVATIONS_PER_KEY = 200;

/**
 * architecture/chart-layouts.md §4.4 — "Backfilled and polled observations go through the
 * same WriteBuffer -> MetricStore.upsert". `WriteBuffer` (storage/write-buffer.service.ts) is
 * constructor-wired to `CANDLE_STORE`/`Candle` specifically, so this mirrors it line-for-line
 * against `METRIC_STORE`/`MetricObservation` instead of genericizing the candle path — same
 * batch/flush policy (N items, T seconds, a UTC-day boundary, or SIGTERM), same reasoning
 * ("loss of at most one buffer on crash is acceptable — the backfill tail re-fetches at boot").
 */
@Injectable()
export class MetricWriteBuffer implements OnModuleDestroy {
  private readonly logger = new Logger(MetricWriteBuffer.name);
  private readonly pending = new Map<string, MetricObservation[]>();
  private readonly lastDayKey = new Map<string, string>();
  private timer: NodeJS.Timeout;
  private readonly flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS;
  private readonly maxObservationsPerKey: number = DEFAULT_MAX_OBSERVATIONS_PER_KEY;

  constructor(
    @Inject(METRIC_STORE) private readonly store: MetricStore,
    private readonly metrics: MetricsService,
  ) {
    this.timer = setInterval(() => this.flushAll(), this.flushIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  private key(observation: MetricObservation): string {
    return `${observation.instrument}|${observation.metric}`;
  }

  private dayKey(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
  }

  async add(observation: MetricObservation): Promise<void> {
    const key = this.key(observation);
    const day = this.dayKey(observation.time);
    const previousDay = this.lastDayKey.get(key);
    this.lastDayKey.set(key, day);

    const list = this.pending.get(key) ?? [];
    list.push(observation);
    this.pending.set(key, list);

    const crossedDayBoundary = previousDay !== undefined && previousDay !== day;
    if (list.length >= this.maxObservationsPerKey || crossedDayBoundary) {
      await this.flushKey(key);
    }
  }

  private async flushKey(key: string): Promise<void> {
    const list = this.pending.get(key);
    if (!list || list.length === 0) return;
    this.pending.set(key, []);
    const startedAt = Date.now();
    try {
      await this.store.upsert(list);
      this.metrics.storageFlushLatencyMs.observe(Date.now() - startedAt);
    } catch (err) {
      this.logger.error(`Metric flush failed for ${key}: ${(err as Error).message}`);
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((key) => this.flushKey(key)));
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.flushAll();
  }
}

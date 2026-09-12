import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Candle, InstrumentId, Timeframe } from '@trade-automation/contracts';
import { MetricsService } from '../observability/metrics.service';
import { CANDLE_STORE, CandleStore } from './candle-store.port';

const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_MAX_BARS_PER_KEY = 200;

/**
 * architecture/live-signal-server.md §4.3 — sits in front of CandleStore.upsert. Batches
 * closed candles per (instrument, tf) and flushes on whichever comes first: N bars, T seconds
 * (default 60s), a UTC-day boundary, or SIGTERM (via `flushAll` on shutdown).
 * Default policy: persist `1m` and any timeframe an enabled strategy actually consumes —
 * `shouldPersist` is supplied by whoever wires this up (main.ts/strategy config), so the
 * WriteBuffer itself makes no assumption about which timeframes matter.
 */
@Injectable()
export class WriteBuffer implements OnModuleDestroy {
  private readonly logger = new Logger(WriteBuffer.name);
  private readonly pending = new Map<string, Candle[]>();
  private readonly lastDayKey = new Map<string, string>();
  private timer: NodeJS.Timeout;
  private shouldPersist: (tf: Timeframe) => boolean = (tf) => tf === '1m';
  private readonly flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS;
  private readonly maxBarsPerKey: number = DEFAULT_MAX_BARS_PER_KEY;

  constructor(
    @Inject(CANDLE_STORE) private readonly store: CandleStore,
    private readonly metrics: MetricsService,
  ) {
    this.timer = setInterval(() => this.flushAll(), this.flushIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  setPersistPredicate(predicate: (tf: Timeframe) => boolean): void {
    this.shouldPersist = predicate;
  }

  private key(instrument: InstrumentId, tf: Timeframe): string {
    return `${instrument}|${tf}`;
  }

  private dayKey(openTime: number): string {
    return new Date(openTime).toISOString().slice(0, 10);
  }

  async add(candle: Candle): Promise<void> {
    if (!this.shouldPersist(candle.timeframe) || !candle.closed) return;

    const key = this.key(candle.instrument, candle.timeframe);
    const day = this.dayKey(candle.openTime);
    const previousDay = this.lastDayKey.get(key);
    this.lastDayKey.set(key, day);

    const list = this.pending.get(key) ?? [];
    list.push(candle);
    this.pending.set(key, list);

    const crossedDayBoundary = previousDay !== undefined && previousDay !== day;
    if (list.length >= this.maxBarsPerKey || crossedDayBoundary) {
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
      this.logger.error(`Flush failed for ${key}: ${(err as Error).message}`);
      // Loss of at most one buffer on crash is acceptable — GapRepair re-fetches the tail
      // from the venue at boot (§6.1 Consistency).
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

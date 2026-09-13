import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subscription } from 'rxjs';
import { Candle, Instrument } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { CANDLE_STORE, CandleStore } from '../storage/candle-store.port';
import { WriteBuffer } from '../storage/write-buffer.service';
import { MetricsService } from '../observability/metrics.service';
import { CandleCache } from './candle-cache.service';
import { ResamplerService } from './resampler.service';
import { GapRepairService } from './gap-repair.service';
import { MarketDataStatusService } from './market-data-status.service';
import { CandleClosedEvent, CandleFormingEvent, MarketDataEvents } from './market-data.events';
import { VenueAdapter } from './venue-adapter.port';
import { buildVenueAdapters } from './venue-adapters.provider';

// How far back to backfill 1m history at boot when storage has nothing yet for an instrument.
// Matches the 1m/3-day default cache depth (candle-cache.service.ts) — this is an
// implementation default, not a value the architecture note pins.
const DEFAULT_WARMUP_LOOKBACK_MS = 3 * 24 * 60 * 60_000;

/**
 * architecture/live-signal-server.md §4.1, §2 — wires VenueAdapter(s) to CandleCache,
 * GapRepair, the event bus, and WriteBuffer for every configured instrument. Boot order per
 * §4.1's GapRepair note: "storage -> venue REST for the tail -> live stream, in that order,
 * so a restart never leaves a hole."
 */
@Injectable()
export class IngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private readonly subscriptions: Subscription[] = [];
  private adapters = new Map<Instrument['venue'], VenueAdapter>();

  constructor(
    private readonly config: AppConfigService,
    private readonly cache: CandleCache,
    private readonly events: EventEmitter2,
    private readonly resamplerService: ResamplerService,
    private readonly gapRepair: GapRepairService,
    private readonly status: MarketDataStatusService,
    private readonly writeBuffer: WriteBuffer,
    private readonly metrics: MetricsService,
    @Inject(CANDLE_STORE) private readonly store: CandleStore,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.adapters = buildVenueAdapters(this.config);

    for (const instrument of this.config.instruments) {
      const adapter = this.adapters.get(instrument.venue);
      if (!adapter) {
        this.logger.warn(`No adapter for venue ${instrument.venue}; ${instrument.id} stays down`);
        this.status.setVenueStatus(instrument.id, 'down');
        continue;
      }
      await this.warmUp(instrument, adapter);
      this.startLiveStream(instrument, adapter);
    }
  }

  private async warmUp(instrument: Instrument, adapter: VenueAdapter): Promise<void> {
    const now = Date.now();
    const currentBarStart = Math.floor(now / 60_000) * 60_000;
    const lastClosedBoundary = currentBarStart - 60_000;

    const latestStored = await this.store.latestOpenTime(instrument.id, '1m');
    const fromStorage = await this.store.query(
      instrument.id,
      '1m',
      now - DEFAULT_WARMUP_LOOKBACK_MS,
      latestStored ?? now,
    );
    for (const c of fromStorage) {
      const stored = { ...c, source: 'storage' as const };
      this.cache.upsert(stored);
      // Same reasoning as the backfilled-candle loop below: rebuild derived-timeframe
      // history directly on every boot, since it is never persisted and the resampler's
      // own bucket state resets to empty each restart.
      for (const derived of this.resamplerService.feed(stored).closed) {
        this.cache.upsert(derived);
      }
    }

    const backfillFrom = latestStored !== null ? latestStored + 60_000 : now - DEFAULT_WARMUP_LOOKBACK_MS;
    if (backfillFrom <= lastClosedBoundary) {
      try {
        const backfilled = await adapter.fetchCandles(instrument, '1m', backfillFrom, lastClosedBoundary);
        for (const c of backfilled) {
          this.cache.upsert(c);
          // Resample directly instead of via the CandleClosed event: this method runs from
          // onApplicationBootstrap, and @nestjs/event-emitter's own listener-binding hook (also
          // onApplicationBootstrap, in a different module) is not guaranteed to have run yet —
          // ResamplerService's @OnEvent handler can have zero listeners registered at this
          // point, silently dropping every derived-timeframe candle from backfilled history.
          // Deliberately NOT emitting CandleClosed here (unlike the live path below): nothing
          // else needs it during boot (no WS client can be connected yet, and StrategyRunner
          // only reacts to *live* closes going forward, using the cache this warm-up already
          // populated for its lookback window) — emitting it as well risks double-feeding the
          // same candle into the resampler's stateful buckets if the listener happens to bind
          // partway through this loop (there's an `await` between instruments).
          for (const derived of this.resamplerService.feed(c).closed) {
            this.cache.upsert(derived);
          }
          this.status.recordClosedCandle(instrument.id, c.openTime);
        }
        if (backfilled.length > 0) {
          await this.store.upsert(backfilled);
          this.gapRepair.seed(instrument.id, backfilled[backfilled.length - 1].openTime);
        }
        this.logger.log(`Warm-up backfilled ${backfilled.length} 1m bars for ${instrument.id}`);
      } catch (err) {
        this.logger.error(`Warm-up backfill failed for ${instrument.id}: ${(err as Error).message}`);
      }
    } else if (latestStored !== null) {
      this.gapRepair.seed(instrument.id, latestStored);
    }

    this.status.setVenueStatus(instrument.id, 'up');
  }

  private startLiveStream(instrument: Instrument, adapter: VenueAdapter): void {
    const sub = adapter.streamCandles(instrument).subscribe({
      next: (candle: Candle) => this.handleCandle(instrument, adapter, candle),
      error: (err: Error) => {
        this.logger.error(`Stream error for ${instrument.id}: ${err.message}`);
        this.status.setVenueStatus(instrument.id, 'degraded');
      },
    });
    this.subscriptions.push(sub);

    const healthSub = adapter.health().subscribe((v) => this.status.setVenueStatus(instrument.id, v));
    this.subscriptions.push(healthSub);
  }

  private async handleCandle(instrument: Instrument, adapter: VenueAdapter, candle: Candle): Promise<void> {
    this.metrics.candlesReceived.inc({ instrument: instrument.id, timeframe: candle.timeframe });

    if (!candle.closed) {
      this.events.emit(MarketDataEvents.CandleForming, new CandleFormingEvent(candle));
      return;
    }

    const currentStatus = this.status.get(instrument.id).venueStatus;
    const { ordered, gap } = await this.gapRepair.onClosed1m(instrument, candle, adapter, currentStatus);

    for (const c of ordered) {
      this.cache.upsert(c);
      this.events.emit(MarketDataEvents.CandleClosed, new CandleClosedEvent(c));
      this.status.recordClosedCandle(instrument.id, c.openTime);
      this.metrics.candlesClosed.inc({ instrument: instrument.id, timeframe: c.timeframe });
      this.metrics.feedLagMs.set({ instrument: instrument.id }, Date.now() - (c.openTime + 60_000));
      void this.writeBuffer.add(c);
    }

    if (gap) {
      this.status.recordGap(instrument.id);
      this.metrics.gapCount.inc({ instrument: instrument.id });
      this.metrics.gapRepairedBars.inc({ instrument: instrument.id }, gap.count);
      this.events.emit(MarketDataEvents.GapRepaired, {
        instrument: instrument.id,
        timeframe: '1m',
        from: gap.from,
        to: gap.to,
        count: gap.count,
      });
      this.logger.warn(`Repaired gap for ${instrument.id}: ${gap.count} bars [${gap.from}, ${gap.to}]`);
    }
  }

  onModuleDestroy(): void {
    for (const sub of this.subscriptions) sub.unsubscribe();
  }
}

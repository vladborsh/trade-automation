import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subscription } from 'rxjs';
import { Candle, Instrument, Timeframe, Venue } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { CANDLE_STORE, CandleStore } from '../storage/candle-store.port';
import { WriteBuffer } from '../storage/write-buffer.service';
import { MetricsService } from '../observability/metrics.service';
import { CandleCache } from './candle-cache.service';
import { Resampler } from './resampler';
import { ResamplerService } from './resampler.service';
import { GapRepairService } from './gap-repair.service';
import { MarketDataStatusService } from './market-data-status.service';
import { CandleClosedEvent, CandleFormingEvent, MarketDataEvents } from './market-data.events';
import { VenueAdapter } from './venue-adapter.port';
import { VENUE_ADAPTERS_MAP } from './venue-adapters.provider';
import { CapComPriceNotFoundError } from './capitalcom/capitalcom.adapter';

// How far back to backfill 1m history at boot when storage has nothing yet for an instrument.
// Matches the 1m/3-day default cache depth (candle-cache.service.ts) — this is an
// implementation default, not a value the architecture note pins.
const DEFAULT_WARMUP_LOOKBACK_MS = 3 * 24 * 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/** architecture/live-signal-server.md §12.1/§12.2 — venue-native accelerator scope. */
const NATIVE_COARSE_TIMEFRAMES: Timeframe[] = ['1h', '4h', '1d'];

/** §12.2's boot targets for the native `1h`/`4h` fetch — 45 days on both venues. */
const NATIVE_COARSE_LOOKBACK_MS = 45 * DAY_MS;

/** §12.2's `1d` target: Binance goes 2 years back; that duration is meaningless for Capital.com. */
const BINANCE_1D_LOOKBACK_MS = 730 * DAY_MS;

/**
 * §12.2/§12.4: the VWAP research probe (`research/cmc-bot-vwap/results/capital_com_floor_probe.txt`)
 * confirmed `HOUR`/`DAY` resolution is served at 2022-09-12/2022-09-01 respectively for
 * US100/US500/EURCHF/GBPCHF — the earliest dates it happened to try, not a bisected floor. No
 * live Capital.com credentials were available in this environment to re-probe the exact floor
 * (§12.4 asks for exactly that verification before hardcoding a number "user-facing"). This is
 * therefore a **documented assumption, not a confirmed floor**: fetch from here, and let a 404
 * (`CapComPriceNotFoundError`) tell us if even this date is too deep for a given instrument.
 */
const CAP_COM_DOCUMENTED_COARSE_FLOOR_MS = Date.UTC(2022, 8, 12);

/** §12.5 item 1 — one deep 1m backfill chunk at a time, day-aligned (see `deepenInstrument1m`). */
const DEEP_1M_LOOKBACK_MS = 45 * DAY_MS;
const DEEP_1M_CHUNK_DAYS = 3;

/**
 * architecture/live-signal-server.md §4.1, §2, §12 — wires VenueAdapter(s) to CandleCache,
 * GapRepair, the event bus, and WriteBuffer for every configured instrument. Boot order per
 * §4.1's GapRepair note: "storage -> venue REST for the tail -> live stream, in that order,
 * so a restart never leaves a hole."
 */
@Injectable()
export class IngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private readonly subscriptions: Subscription[] = [];

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
    @Inject(VENUE_ADAPTERS_MAP) private readonly adapters: Map<Venue, VenueAdapter>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const instrument of this.config.instruments) {
      const adapter = this.adapters.get(instrument.venue);
      if (!adapter) {
        this.logger.warn(`No adapter for venue ${instrument.venue}; ${instrument.id} stays down`);
        this.status.setVenueStatus(instrument.id, 'down');
        continue;
      }
      // Phase 1 (§12.3): both steps below are synchronous, before app.listen() — the existing
      // 3-day 1m warm-up (unchanged) plus the new native 1h/4h/1d fetch. Cheap: 1-2 REST calls
      // per instrument per timeframe, so the chart is usable at full §12.2 depth on first boot
      // for every timeframe except the deep 1m/derived-from-1m window (Phase 2, async below).
      await this.warmUp(instrument, adapter);
      await this.warmUpNativeCoarse(instrument, adapter);
      this.startLiveStream(instrument, adapter);
    }
  }

  /**
   * Phase 2 (§12.3): fired from `main.ts` after `app.listen()`. Deepens the `1m` backfill per
   * instrument from the Phase 1 boot window out to `DEEP_1M_LOOKBACK_MS` (45 days), which also
   * naturally deepens 5m/15m/1h/4h/1d as a side effect of resampling that wider 1m window
   * (§12.2's 5m/15m 10-day target is *only* reached this way — Phase 1 deliberately keeps the
   * 1m warm-up at 3 days).
   */
  async deepenHistoryAsync(): Promise<void> {
    for (const instrument of this.config.instruments) {
      const adapter = this.adapters.get(instrument.venue);
      if (!adapter) continue;
      this.status.setBackfillStatus(instrument.id, '1m', 'deepening');
      try {
        await this.deepenInstrument1m(instrument, adapter);
      } catch (err) {
        this.logger.error(`Deep 1m backfill failed for ${instrument.id}: ${(err as Error).message}`);
      } finally {
        // "complete" means this pass finished running (reached the 45-day target, hit the
        // venue's own listing-date floor, or gave up after a page error) — not necessarily that
        // the full target depth was reached. §12.3 wants an honest "still running" signal on
        // /api/health, not a retry loop; a genuinely partial result is still visible as such
        // through however far CandleCache.covers() actually reaches.
        this.status.setBackfillStatus(instrument.id, '1m', 'complete');
      }
    }
  }

  /**
   * Walks `1m` backwards from wherever the cache currently ends, one UTC-day-aligned chunk at a
   * time, "oldest page last" (§12.3 Phase 2): each chunk is upserted into `CandleCache`/
   * `CandleStore` before the next (older) one is fetched, so `CandleCache.covers()`'s
   * "`list[0].openTime <= from`" contract only ever gets *more* true as this runs, never
   * momentarily wrong — a mid-run request for a date this loop hasn't reached yet still falls
   * through to `CandleStore`/venue exactly like today's cache-miss path, and never sees a hole
   * dressed up as coverage.
   *
   * Chunk boundaries are pinned to UTC midnight specifically so that every derived-timeframe
   * bucket (5m/15m/1h/4h/1d all divide evenly into a UTC day and never cross midnight) is either
   * fully inside one chunk or fully inside the next — never split across the chunk boundary. That
   * is what makes it safe to resample each chunk with its own fresh, throwaway `Resampler`
   * instance (see below) instead of a single instance spanning the whole 45-day walk.
   */
  private async deepenInstrument1m(instrument: Instrument, adapter: VenueAdapter): Promise<void> {
    const target = Date.now() - DEEP_1M_LOOKBACK_MS;
    const targetDayStart = Math.floor(target / DAY_MS) * DAY_MS;

    // Raise the cache's configured depth *before* growing backwards: CandleCache's ring-buffer
    // eviction always trims the front (oldest bar) once `list.length > maxDepth`, which — for a
    // backward-extending walk that keeps *inserting* at the front — would otherwise immediately
    // evict the very bar this walk just added. See candle-cache.service.ts's module comment.
    this.cache.setMinDepth(instrument.id, '1m', DEEP_1M_LOOKBACK_MS / 60_000);

    const oldestCached = this.cache.window(instrument.id, '1m')[0]?.openTime ?? Date.now();
    let chunkToExclusive = Math.floor(oldestCached / DAY_MS) * DAY_MS;

    while (chunkToExclusive > targetDayStart) {
      const chunkFrom = Math.max(targetDayStart, chunkToExclusive - DEEP_1M_CHUNK_DAYS * DAY_MS);
      const chunkTo = chunkToExclusive - 60_000;

      let page: Candle[];
      try {
        page = await adapter.fetchCandles(instrument, '1m', chunkFrom, chunkTo);
      } catch (err) {
        this.logger.warn(
          `Deep 1m backfill page [${chunkFrom},${chunkTo}] failed for ${instrument.id}: ${(err as Error).message}`,
        );
        break;
      }
      if (page.length === 0) break; // venue has nothing older — its own listing-date floor (§12.2)

      for (const c of page) this.cache.upsert(c);
      await this.store.upsert(page);

      // A fresh Resampler per chunk — deliberately NOT the shared ResamplerService singleton the
      // live stream feeds. That singleton's buckets are keyed by (instrument, tf) with no notion
      // of "this candle is 40 days old, not new" — feeding it 1m candles far older than whatever
      // it has already bucketed for "now" would look like an ordinary bucket-boundary crossing
      // and incorrectly close/corrupt the live 5m/15m/1h/4h/1d bars this backward walk has
      // nothing to do with (Phase 2 runs concurrently with the live stream, after app.listen()).
      // A fresh, per-chunk `Resampler` still reuses the exact same resampling logic — just with
      // isolated state — and (like the shared service's own `feed()`) never touches the event
      // bus, so §12.5 item 1's "don't reintroduce the event-bus race" concern doesn't apply
      // either way. This is a deliberate, narrow deviation from item 1's literal
      // "reuse resamplerService.feed() directly for all of this" — flagged here and in the
      // hand-off report for Architect review, since corrupting live derived candles would be
      // strictly worse than this deviation.
      const chunkResampler = new Resampler();
      for (const c of page) {
        for (const derived of chunkResampler.onClosed1m(c).closed) this.upsertCoarse(instrument, derived);
      }
      // Chunks are UTC-day-aligned, so every bucket starting inside this chunk also closes
      // inside it, except the very last one (nearest `chunkTo`) — that one only closes once the
      // resampler sees a 1m candle from the *next* bucket. That next candle is the first bar of
      // whatever range we already cover (either a more-recent chunk this same walk already
      // processed, or the original Phase 1 boot window) — read it from the cache and feed it
      // just to trigger closure; its own "forming" bucket output is discarded.
      const boundaryCandle = this.cache.query(instrument.id, '1m', chunkToExclusive, chunkToExclusive)[0];
      if (boundaryCandle) {
        for (const derived of chunkResampler.onClosed1m(boundaryCandle).closed) {
          this.upsertCoarse(instrument, derived);
        }
      }

      chunkToExclusive = chunkFrom;
    }
  }

  /**
   * §12.2/§12.3 Phase 1, §12.5 item 3 — synchronous native `1h`/`4h`/`1d` fetch. Cheap (one REST
   * page per timeframe on Binance; one or two on Capital.com's 720-bar-per-page limit) compared
   * to reaching the same depth by resampling 1m. A Capital.com fetch that 404s is the vendor's
   * own retention floor (§12.4) — logged, not fatal to boot.
   */
  private async warmUpNativeCoarse(instrument: Instrument, adapter: VenueAdapter): Promise<void> {
    const now = Date.now();
    for (const tf of NATIVE_COARSE_TIMEFRAMES) {
      const from = this.nativeCoarseFrom(instrument.venue, tf, now);
      try {
        const candles = await adapter.fetchCandles(instrument, tf, from, now);
        for (const c of candles) this.upsertCoarse(instrument, c);
        this.logger.log(`Native ${tf} warm-up fetched ${candles.length} bars for ${instrument.id}`);
      } catch (err) {
        if (err instanceof CapComPriceNotFoundError) {
          this.logger.warn(`Native ${tf} warm-up for ${instrument.id}: vendor floor reached (${err.message})`);
        } else {
          this.logger.error(`Native ${tf} warm-up failed for ${instrument.id}: ${(err as Error).message}`);
        }
      }
    }
  }

  private nativeCoarseFrom(venue: Venue, tf: Timeframe, now: number): number {
    if (tf !== '1d') return now - NATIVE_COARSE_LOOKBACK_MS;
    return venue === 'binance' ? now - BINANCE_1D_LOOKBACK_MS : CAP_COM_DOCUMENTED_COARSE_FLOOR_MS;
  }

  /**
   * §12.1's cross-check: before handing a non-1m candle to `CandleCache.upsert` (which enforces
   * the actual source-priority rule), compare it against whatever already occupies that slot. A
   * disagreement between a `resampled` bar and a `venue-native` one for the same
   * (instrument, timeframe, openTime) is diagnosable (`venue_native_mismatch_count`), never
   * fatal — the resampled bar wins the slot regardless, per `CandleCache`'s tiering.
   */
  private upsertCoarse(instrument: Instrument, candle: Candle): void {
    if (candle.timeframe !== '1m') {
      const existing = this.cache.query(instrument.id, candle.timeframe, candle.openTime, candle.openTime)[0];
      const isOverlapPair =
        existing && existing.source !== candle.source && (existing.source === 'venue-native' || candle.source === 'venue-native');
      if (isOverlapPair && this.candlesDisagree(existing, candle)) {
        this.metrics.venueNativeMismatchCount.inc({ instrument: instrument.id, timeframe: candle.timeframe });
        this.logger.warn(
          `venue-native/resampled mismatch for ${instrument.id} ${candle.timeframe}@${new Date(candle.openTime).toISOString()}`,
        );
      }
    }
    this.cache.upsert(candle);
  }

  private candlesDisagree(a: Candle, b: Candle): boolean {
    const TOLERANCE = 0.001; // 0.1% relative — a venue's own coarse aggregation vs. our 1m resample can differ slightly (rounding, mid-vs-last-trade) without being "wrong"
    const rel = (x: number, y: number) => Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y), 1e-9);
    return rel(a.open, b.open) > TOLERANCE || rel(a.high, b.high) > TOLERANCE || rel(a.low, b.low) > TOLERANCE || rel(a.close, b.close) > TOLERANCE;
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
        this.upsertCoarse(instrument, derived);
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
            this.upsertCoarse(instrument, derived);
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
      if (gap.error) {
        this.logger.warn(
          `Gap unrepaired for ${instrument.id} [${gap.from}, ${gap.to}]: ${gap.error} — continuing with a hole rather than crashing`,
        );
      } else {
        this.logger.warn(`Repaired gap for ${instrument.id}: ${gap.count} bars [${gap.from}, ${gap.to}]`);
      }
    }
  }

  onModuleDestroy(): void {
    for (const sub of this.subscriptions) sub.unsubscribe();
  }
}

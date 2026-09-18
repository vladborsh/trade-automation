import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subscription } from 'rxjs';
import {
  BackfillStatus,
  Instrument,
  InstrumentId,
  MetricKind,
  MetricObservation,
  Venue,
} from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { METRIC_STORE, MetricStore } from '../../storage/metric-store.port';
import { MetricWriteBuffer } from '../../storage/metric-write-buffer.service';
import { MetricsService } from '../../observability/metrics.service';
import { BarClock } from '../bar-clock.service';
import { MetricCache } from './metric-cache.service';
import { MetricAdapter, TipPrice } from './metric-adapter.port';
import { MetricEvents, MetricObservedEvent } from './metric.events';
import { buildMetricAdapters } from '../metric-adapters.provider';
import { TIP_PRICE_MAX_AGE_MS, acceptTipPrice, tipPriceAt, withDerivedNotional } from './tip-notional';

// Matches MetricCache's default depth (metric-cache.service.ts) and the confirmed Binance
// openInterestHist retention (binance-metrics.adapter.ts) — no point asking the venue for
// more history than either can hold or serve.
const DEFAULT_CACHE_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
// architecture/aggregate-oi.md §5 "never on the boot path" — Phase 1 (warm-up, before listen())
// asks a venue for at most this much tail: one or two pages on any adapter (Bybit: 288 rows =
// 2 OI pages + 1 mark page). Everything older — a fresh store's 30 days, or the part of a long
// outage beyond 24 h — is Phase 2's job (deepenHistoryAsync, after listen()).
const WARMUP_TAIL_MS = 24 * 60 * 60_000;
// architecture/chart-layouts.md §4.4 — spreads polls across a boundary tick instead of firing
// every pair at exactly the same millisecond.
const MAX_POLL_JITTER_MS = 2000;
// The poll gate's allowance for BarClock tick jitter. Ticks are nominally METRIC_POLL_INTERVAL_MS
// apart but can land a few ms early; a strict `now − last < intervalMs` then skips every such tick
// and a pair polls every ~2 min instead of every minute (measured 2026-09-18: Hyperliquid, whose
// only history is what we poll — aggregate-oi.md §6 — got 2-min samples, and C3 kept withholding
// the forming 5 m bar). 5 s is far above tick jitter and far below any sane interval, so a real
// duplicate tick (same minute) is still skipped. Wall-clock with tolerance, not a bar index, so
// the gate stays correct for an interval that is not a whole number of ticks.
const POLL_TICK_TOLERANCE_MS = 5_000;
// architecture/aggregate-oi.md §5 — one resumable step of the deep crawl: 7 days of 5 m rows =
// 2 016 rows ≈ 11 OI pages + 3 mark-kline pages on Bybit, persisted before the next step.
const DEEP_CRAWL_CHUNK_MS = 7 * 24 * 60 * 60_000;

interface MetricPairStatus {
  instrument: InstrumentId;
  metric: MetricKind;
  lastObservationAge: number | null;
  backfillStatus: BackfillStatus;
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
  private readonly backfillStatusByPair = new Map<string, BackfillStatus>();
  /** Phase 1 tails cut at WARMUP_TAIL_MS: `[from, to]` still to fetch in Phase 2, by pair. */
  private readonly deferredGaps = new Map<string, { from: number; to: number }>();
  /** Pairs currently in a missing-notional streak — one warn per streak, not per poll. */
  private readonly notionalMissingPairs = new Set<string>();

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
    this.adapters = buildMetricAdapters(this.config, this.appMetrics);

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

    // Tail since the latest stored row, capped at WARMUP_TAIL_MS; a fresh store gets the last
    // 24 h only and Phase 2's deepen walks back from there.
    const tailStart = now - WARMUP_TAIL_MS;
    const sinceStored = latestStored !== null ? latestStored + 1 : tailStart;
    if (sinceStored < tailStart) {
      this.deferredGaps.set(this.pairKey(instrument.id, metric), { from: sinceStored, to: tailStart - 1 });
    }
    const backfillFrom = Math.max(sinceStored, tailStart);
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

  /**
   * architecture/panel-sync-and-oi-depth-diagnosis.md, Bug 2, defect 2 — fired from `main.ts`
   * after `app.listen()`, mirroring `IngestionService.deepenHistoryAsync()`'s Phase 2 concept:
   * `warmUp`'s Phase 1 only ever extends *forward* from `latestStored`, so whatever depth the
   * very first boot happened to reach (one adapter page, before defect 1 was fixed; or the
   * venue's true depth after) is otherwise frozen forever. This walks every configured pair
   * backward to the full `DEFAULT_CACHE_LOOKBACK_MS` window on every boot, so a shallow store
   * self-heals instead of staying shallow across restarts.
   */
  async deepenHistoryAsync(): Promise<void> {
    for (const { instrument, metric } of this.metricPairs()) {
      const adapter = this.adapters.get(instrument.venue);
      if (!adapter || !adapter.supports.includes(metric)) continue;
      const key = this.pairKey(instrument.id, metric);
      this.backfillStatusByPair.set(key, 'deepening');
      try {
        await this.repairTipNotional(instrument, metric, adapter);
      } catch (err) {
        this.logger.error(`Tip-notional repair failed for ${key}: ${(err as Error).message}`);
      }
      try {
        await this.deepenPair(instrument, metric, adapter);
      } catch (err) {
        this.logger.error(`Metric deepen failed for ${key}: ${(err as Error).message}`);
      } finally {
        // Same "complete means this pass finished running" semantics as the candle path's
        // Phase 2 — not necessarily that the full target depth was reached (a short venue
        // history or a page error still ends the pass, honestly reflected by however far
        // MetricCache.window() actually reaches).
        this.backfillStatusByPair.set(key, 'complete');
      }
    }

    // aggregate-oi.md §5 — adapters whose history outlives the cache window (Bybit: 3 y) are
    // crawled only after every pair has its 30 days, so a 16-minute crawl delays nobody.
    for (const { instrument, metric } of this.metricPairs()) {
      const adapter = this.adapters.get(instrument.venue);
      if (!adapter || !adapter.supports.includes(metric)) continue;
      if ((adapter.historyDepthMs ?? DEFAULT_CACHE_LOOKBACK_MS) <= DEFAULT_CACHE_LOOKBACK_MS) continue;
      const key = this.pairKey(instrument.id, metric);
      this.backfillStatusByPair.set(key, 'deepening');
      try {
        await this.crawlBeyondCache(instrument, metric, adapter, adapter.historyDepthMs!);
      } catch (err) {
        this.logger.error(`Deep history crawl stopped for ${key} (resumes next boot): ${(err as Error).message}`);
      } finally {
        this.backfillStatusByPair.set(key, 'complete');
      }
    }
  }

  /**
   * architecture/aggregate-oi.md §5 "Deep crawl" — Phase 2 only, resumable: walks back from the
   * OLDEST STORED row (or the cache window's edge, whichever is older) to `now − depthMs` in
   * DEEP_CRAWL_CHUNK_MS chunks, each awaited straight into MetricStore — so `earliestTime` moves
   * with every chunk and an interrupted crawl (restart, 403) continues where it stopped on the
   * next boot. Rows are older than MetricCache's window, so they never enter the cache (served
   * from the store). Pacing, 403/429 and retCode handling live in the adapter; any error ends
   * the pass. An empty chunk means the venue has nothing older (listing date): stop.
   */
  private async crawlBeyondCache(
    instrument: Instrument,
    metric: MetricKind,
    adapter: MetricAdapter,
    depthMs: number,
  ): Promise<void> {
    const now = Date.now();
    const target = now - depthMs;
    const earliestStored = await this.store.earliestTime(instrument.id, metric);
    let cursor = Math.min(earliestStored ?? Infinity, now - DEFAULT_CACHE_LOOKBACK_MS);
    let crawled = 0;
    while (cursor > target) {
      const chunkFrom = Math.max(target, cursor - DEEP_CRAWL_CHUNK_MS);
      const rows = await adapter.fetchObservations(instrument, metric, chunkFrom, cursor - 1);
      if (rows.length === 0) {
        this.logger.log(`No ${instrument.id}/${metric} history before ${new Date(cursor).toISOString()}; crawl ends`);
        break;
      }
      await this.store.upsert(rows);
      crawled += rows.length;
      cursor = chunkFrom;
    }
    this.logger.log(
      `Deep crawl stored ${crawled} observations for ${instrument.id}/${metric}; ` +
        `store now reaches ${new Date(cursor).toISOString()} (target ${new Date(target).toISOString()})`,
    );
  }

  /**
   * Fetches the whole `[now − DEFAULT_CACHE_LOOKBACK_MS, oldest cached observation)` window in
   * one call — deliberately not chunked like the candle path's `deepenInstrument1m`: that method
   * chunks to keep a *live* resampler's stateful buckets safe from 45 days of out-of-order 1m
   * candles, a concern that does not exist here (metrics have no resampler, and `MetricCache`'s
   * fixed 30-day `depthMs` — matching `DEFAULT_CACHE_LOOKBACK_MS` — never evicts a backward
   * insert, unlike `CandleCache`'s ring buffer). `fetchObservations` itself still paginates
   * internally (the adapter's own 500-row pages), so nothing here loses the note's "walk
   * oldest-page-last" property — the adapter returns the whole window pre-assembled ascending.
   */
  private async deepenPair(instrument: Instrument, metric: MetricKind, adapter: MetricAdapter): Promise<void> {
    const now = Date.now();
    const target = now - DEFAULT_CACHE_LOOKBACK_MS;
    await this.fillDeferredGap(instrument, metric, adapter, target);
    const oldestCached = this.cache.window(instrument.id, metric)[0]?.time ?? now;
    if (oldestCached <= target) return; // already at (or past) full depth

    const deepRows = await adapter.fetchObservations(instrument, metric, target, oldestCached - 1);
    for (const o of deepRows) {
      this.cache.upsert(o);
      void this.writeBuffer.add(o);
      // Deliberately NOT emitting MetricEvents.MetricObserved for deep rows — same reasoning as
      // the candle deepen: thousands of historical points pushed to the bus/gateway on every
      // boot is noise no live WS client needs, they only want the current value going forward.
    }
    this.logger.log(`Deepened ${deepRows.length} historical observations for ${instrument.id}/${metric}`);
  }

  /**
   * aggregate-oi.md §5 — the part of a post-outage tail that Phase 1 left out (older than
   * WARMUP_TAIL_MS). Rows inside the cache window go to the cache + write buffer; older ones
   * (a deep-history adapter after a long outage) straight to the store, never into the cache.
   * No MetricObserved — history, not the live tip.
   */
  private async fillDeferredGap(
    instrument: Instrument,
    metric: MetricKind,
    adapter: MetricAdapter,
    cacheTarget: number,
  ): Promise<void> {
    const key = this.pairKey(instrument.id, metric);
    const gap = this.deferredGaps.get(key);
    if (!gap) return;
    const rows = await adapter.fetchObservations(instrument, metric, gap.from, gap.to);
    const old = rows.filter((o) => o.time < cacheTarget);
    if (old.length > 0) await this.store.upsert(old);
    for (const o of rows) {
      if (o.time < cacheTarget) continue;
      this.cache.upsert(o);
      void this.writeBuffer.add(o);
    }
    this.deferredGaps.delete(key);
    this.logger.log(`Filled ${rows.length} observations of the deferred warm-up gap for ${key}`);
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
    if (now - last < intervalMs - POLL_TICK_TOLERANCE_MS) return;
    this.lastPolledAt.set(key, now);

    const jitterMs = Math.floor(Math.random() * MAX_POLL_JITTER_MS);
    if (jitterMs > 0) await new Promise((resolve) => setTimeout(resolve, jitterMs));

    try {
      // §11.1 — the tip price rides the same poll; its failure must never cost the OI snapshot.
      const [snapshot, tipPrice] = await Promise.all([
        adapter.fetchLatest(instrument, metric),
        this.fetchTipPrice(adapter, instrument),
      ]);
      const observation = this.deriveTipNotional(snapshot, tipPrice, key);
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

  /** `null` when the adapter has no tip price or the request fails (logged in the streak warn). */
  private async fetchTipPrice(
    adapter: MetricAdapter,
    instrument: Instrument,
  ): Promise<TipPrice | { error: string } | null> {
    if (!adapter.fetchTipPrice) return null;
    try {
      return await adapter.fetchTipPrice(instrument);
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  /**
   * architecture/chart-layouts.md §11.1 "The live tip" — `/fapi/v1/openInterest` has no
   * notional, so derive it from the venue's mark price (premiumIndex, fetched in the same poll —
   * the basis of the venue's own `sumOpenInterestValue`, see binance-metrics.adapter.ts), if
   * that price is stamped within 120 s of the snapshot's venue `time`. Otherwise (stale, or the
   * price request failed) the snapshot is stored with `value`/`unit` only — never an old price —
   * counted in `metric_notional_missing_total` and warned about once per streak. An adapter
   * with no tip price at all (replay) is not a miss: it never had one to give.
   */
  private deriveTipNotional(
    observation: MetricObservation,
    tipPrice: TipPrice | { error: string } | null,
    key: string,
  ): MetricObservation {
    if (observation.notional !== undefined || tipPrice === null) return observation;
    const price = 'error' in tipPrice ? null : acceptTipPrice(tipPrice, observation.time);
    if (price !== null) {
      if (this.notionalMissingPairs.delete(key)) {
        this.logger.log(`Derived notional restored for ${key}`);
      }
      return withDerivedNotional(observation, price);
    }
    this.appMetrics.metricNotionalMissingTotal.inc({
      instrument: observation.instrument,
      metric: observation.metric,
    });
    if (!this.notionalMissingPairs.has(key)) {
      this.notionalMissingPairs.add(key);
      const reason =
        'error' in tipPrice
          ? `tip price request failed (${tipPrice.error})`
          : `tip price at ${new Date(tipPrice.time).toISOString()} is more than ${TIP_PRICE_MAX_AGE_MS / 1000}s ` +
            `from the snapshot at ${new Date(observation.time).toISOString()}`;
      this.logger.warn(`No notional for ${key}: ${reason}; storing snapshots without notional until it recovers`);
    }
    return observation;
  }

  /**
   * architecture/chart-layouts.md §11.1 "Legacy tip rows" — once per boot, idempotent: live
   * snapshots stored before the tip rule existed (or while no fresh price was available) have
   * no notional. Derive it with the same basis — 1m mark-price bars (markPriceKlines, fetched
   * only around the rows still lacking notional; weight and pacing in binance-metrics.adapter.ts)
   * — taking the bar that closed within 120 s before each row, and re-upsert through
   * MetricWriteBuffer. Rows with no qualifying bar stay as they are (retried on the next boot).
   * Runs from `deepenHistoryAsync` (after `listen()`), so it never delays boot. Deliberately
   * emits no MetricObserved — these are history, not the live tip.
   */
  private async repairTipNotional(instrument: Instrument, metric: MetricKind, adapter: MetricAdapter): Promise<void> {
    if (!adapter.fetchTipPriceHistory) return;
    const missing = this.cache.window(instrument.id, metric).filter((o) => o.notional === undefined);
    if (missing.length === 0) return;

    const prices = await adapter.fetchTipPriceHistory(
      instrument,
      missing.map((o) => o.time),
    );
    let repaired = 0;
    for (const o of missing) {
      const price = tipPriceAt(prices, o.time);
      if (price === null) continue;
      const fixed = withDerivedNotional(o, price);
      this.cache.upsert(fixed);
      void this.writeBuffer.add(fixed);
      repaired++;
    }
    this.logger.log(
      `Tip-notional repair for ${instrument.id}/${metric}: ${repaired} of ${missing.length} stored ` +
        `snapshots given a derived notional; ${missing.length - repaired} have no mark price within 120 s`,
    );
  }

  /** architecture/chart-layouts.md §4.4 — backs `GET /api/health`'s `metrics` field. */
  status(): MetricPairStatus[] {
    const now = Date.now();
    return this.metricPairs().map(({ instrument, metric }) => {
      const key = this.pairKey(instrument.id, metric);
      const lastTime = this.lastObservationAt.get(key) ?? null;
      return {
        instrument: instrument.id,
        metric,
        lastObservationAge: lastTime !== null ? now - lastTime : null,
        backfillStatus: this.backfillStatusByPair.get(key) ?? 'complete',
      };
    });
  }

  onModuleDestroy(): void {
    for (const sub of this.subscriptions) sub.unsubscribe();
  }
}

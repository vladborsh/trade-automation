import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subscription } from 'rxjs';
import {
  BackfillStatus,
  MetricSource,
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
import { assertAggregateMembersIngestible } from '../../config/metric-aggregates.schema';
import { TIP_PRICE_MAX_AGE_MS, acceptTipPrice, tipPriceAt, withDerivedNotional } from './tip-notional';

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
   *
   * architecture/aggregate-oi.md §3.2 — plus every member of every configured aggregate, as a
   * MetricSource (the Bybit / Hyperliquid legs are not chart instruments). Deduplicated by
   * (id, metric): `binance:BTCUSDT` is both a panel instrument and a member, ingested once.
   */
  private metricPairs(): { instrument: MetricSource; metric: MetricKind }[] {
    const byId = new Map(this.config.instruments.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const pairs: { instrument: MetricSource; metric: MetricKind }[] = [];
    const add = (instrument: MetricSource, metric: MetricKind) => {
      const key = this.pairKey(instrument.id, metric);
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push({ instrument, metric });
    };
    for (const layout of this.config.layouts) {
      for (const panel of layout.panels) {
        if (panel.kind !== 'metric' || !panel.metric) continue;
        const instrument = byId.get(panel.instrument);
        if (instrument) add(instrument, panel.metric);
      }
    }
    for (const aggregate of this.config.metricAggregates ?? []) {
      for (const member of aggregate.members) add(member, aggregate.metric);
    }
    return pairs;
  }

  async onApplicationBootstrap(): Promise<void> {
    this.adapters = buildMetricAdapters(this.config);
    // aggregate-oi.md §3.3 — a member no adapter can ingest is a boot failure, not a 'down' pair.
    assertAggregateMembersIngestible(this.config.metricAggregates ?? [], this.adapters);

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

  private async warmUp(instrument: MetricSource, metric: MetricKind, adapter: MetricAdapter): Promise<void> {
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
  private async deepenPair(instrument: MetricSource, metric: MetricKind, adapter: MetricAdapter): Promise<void> {
    const now = Date.now();
    const target = now - DEFAULT_CACHE_LOOKBACK_MS;
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

  private startPolling(instrument: MetricSource, metric: MetricKind, adapter: MetricAdapter): void {
    const key = this.pairKey(instrument.id, metric);
    const sub = this.barClock.tick$.subscribe(() => void this.maybePoll(instrument, metric, adapter, key));
    this.subscriptions.push(sub);
  }

  private async maybePoll(
    instrument: MetricSource,
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
    instrument: MetricSource,
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
  private async repairTipNotional(instrument: MetricSource, metric: MetricKind, adapter: MetricAdapter): Promise<void> {
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

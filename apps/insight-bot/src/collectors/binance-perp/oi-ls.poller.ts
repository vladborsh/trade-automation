import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { Db, DB } from '../../db/db.port';
import { PartitionMaintenanceService } from '../../db/partitions.service';
import { MetricsService } from '../../ops/metrics.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { Writers } from '../writers/batch-writer';
import { CollectorGapRow, LongShortRow, OpenInterestRow } from '../writers/tables';
import { BinanceWeightTracker } from './binance-weight.tracker';
import { FuturesDataClient, PAGE_LIMIT, RETENTION_MS } from './futures-data.client';
import {
  ACCOUNT_RATIO_ENDPOINTS,
  LongShortAccountRow,
  mapLongShortAccount,
  mapOpenInterestHist,
  mapTakerRatio,
  OpenInterestHistRow,
  TakerRatioRow,
  VENUE,
} from './oi-ls.mapper';
import { missingRanges, nextPollAt, SLOT_MS, slotForPoll } from './slot-grid';

export const STREAM_ID = 'binance-perp:oi-ls-5m';
const PERIOD = '5m';

/**
 * architecture/insight-bot-system-design.md §4.1, §4.5 — OI and the four long/short series at
 * 5 m, polled at every 5-minute boundary **+ 20 s** (the venue publishes on the boundary with a
 * lag), for every active universe symbol.
 *
 * **REST weight: 5 calls × 30 symbols per 5 min = 150 calls per 5 min, i.e. §4.5's 30
 * weight/min AVERAGED over the interval (1.25 % of 2400).** Measured on the acceptance run, the
 * instantaneous trailing-minute figure during a pass is ~150, not 30: a pass takes about a
 * minute of wall clock, so its calls land inside one minute rather than spread across the five.
 * That peak is 6.25 % of the budget and well inside it, but `ib_binance_weight_used_1m` reads
 * ~150 while a pass is running and decays to 0 between passes — which is the true picture, and
 * the reason the gauge must be a live reading rather than a number pushed once per poll. The boot backfill is a one-off on top: at most
 * ⌈30 days / (500 slots × 5 min)⌉ = 18 pages per series per symbol, 5 × 18 × 30 = 2700 calls,
 * paced at `BACKFILL_PACING_MS` so it spreads over minutes rather than bursting through the
 * budget.
 *
 * These endpoints send no `X-MBX-USED-WEIGHT-1M` header (measured — see
 * `futures-data.client.ts`), so `ib_binance_weight_used_1m` is fed by
 * `BinanceWeightTracker`'s own count while only this loop is running.
 */
export const BACKFILL_PACING_MS = 120;

/**
 * Rows fetched per series per poll.
 *
 * §4.1 says the venue "publishes on the boundary with a lag", which the +20 s offset is meant to
 * absorb. **Measured 2026-09-28: the lag is per-symbol and routinely longer than that** — at
 * 169 s past the 13:50 boundary, ETH/ONE/QNT/MARSCOIN had published 13:50 but BTCUSDT was still
 * a slot behind. Over a 30-symbol pass (~60 s) different symbols therefore land in different
 * slots, which is exactly what the first live run showed (23 symbols on 13:45, 8 on 13:50).
 *
 * With `limit=1` that is not merely late, it **loses slots permanently**: if 13:55's poll returns
 * 13:50 and 14:00's returns 14:00, nothing ever fetches 13:55. Asking for the last three rows
 * closes it — a request costs the same weight whatever its `limit`, the writes are idempotent on
 * the natural key (D12), so re-writing an already-stored slot is free.
 */
export const POLL_LIMIT = 3;

@Injectable()
export class OiLsPoller implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OiLsPoller.name);
  private readonly client: FuturesDataClient;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) private readonly db: Db,
    private readonly partitions: PartitionMaintenanceService,
    private readonly writers: Writers,
    private readonly weight: BinanceWeightTracker,
    private readonly metrics: MetricsService,
    private readonly streams: StreamRegistry,
    // @Optional(): Nest must not try to resolve this — it is the specs' injection point, and the
    // real client is built below from the configured base URL.
    @Optional() client?: FuturesDataClient,
  ) {
    this.client =
      client ??
      new FuturesDataClient({
        baseUrl: this.config.env.get('BINANCE_FUTURES_REST_BASE_URL'),
        weight: this.weight,
      });
    this.streams.register(STREAM_ID, VENUE);
    // Read live at scrape time, so the gauge decays with the trailing minute instead of holding
    // the last poll's figure for five minutes.
    this.metrics.setBinanceWeightSource(() => this.weight.used1m());
  }

  /**
   * `onApplicationBootstrap`, not `onModuleInit`: the partitions must exist before anything
   * writes, and `DbModule.onModuleInit` is what creates them (§3.1). The backfill is
   * fire-and-forget — it takes minutes across 30 symbols and must not hold up the listener or
   * `/health`, which is how its progress is watched.
   */
  onApplicationBootstrap(): void {
    this.start();
    void this.backfill().catch((err) => this.logger.error(`OI/LS boot backfill failed: ${(err as Error).message}`));
  }

  /** The active universe symbols, by their Binance USD-M symbol (§2.3). */
  private symbols(): string[] {
    return this.config.symbols.map((s) => s.binance_perp);
  }

  // -------------------------------------------------------------------------------------------
  // The 5-minute loop
  // -------------------------------------------------------------------------------------------

  /** Schedules the next poll at the next boundary + 20 s, and keeps rescheduling. */
  start(now = Date.now()): void {
    this.stopped = false;
    this.scheduleNext(now);
  }

  private scheduleNext(now: number): void {
    if (this.stopped) return;
    const at = nextPollAt(now);
    this.timer = setTimeout(() => {
      void this.pollOnce()
        .catch((err) => this.logger.error(`OI/LS poll failed: ${(err as Error).message}`))
        .finally(() => this.scheduleNext(Date.now()));
    }, at - now);
    this.timer.unref();
  }

  /**
   * One pass over the universe: the last `POLL_LIMIT` rows per series, which covers the venue's
   * per-symbol publication lag (see POLL_LIMIT). A symbol that fails does not stop the others —
   * its slot stays missing, is recorded in `collector_gaps`, and the next poll or the next boot's
   * backfill picks it up.
   */
  async pollOnce(at = Date.now()): Promise<{ oi: number; longShort: number; failed: string[] }> {
    const slot = slotForPoll(at);
    const oiRows: OpenInterestRow[] = [];
    const lsRows: LongShortRow[] = [];
    const failed: string[] = [];

    for (const symbol of this.symbols()) {
      try {
        const oi = await this.client.fetchPage<OpenInterestHistRow>({
          endpoint: 'openInterestHist', symbol, period: PERIOD, limit: POLL_LIMIT,
        });
        oiRows.push(...mapOpenInterestHist(oi, symbol, 'rest'));

        for (const { endpoint, kind } of ACCOUNT_RATIO_ENDPOINTS) {
          const rows = await this.client.fetchPage<LongShortAccountRow>({ endpoint, symbol, period: PERIOD, limit: POLL_LIMIT });
          lsRows.push(...mapLongShortAccount(rows, symbol, kind, 'rest'));
        }
        const taker = await this.client.fetchPage<TakerRatioRow>({
          endpoint: 'takerlongshortRatio', symbol, period: PERIOD, limit: POLL_LIMIT,
        });
        lsRows.push(...mapTakerRatio(taker, symbol, 'rest'));
      } catch (err) {
        failed.push(symbol);
        this.logger.warn(`OI/LS ${symbol} at slot ${new Date(slot).toISOString()}: ${(err as Error).message}`);
      }
    }

    await this.writers.openInterest.write(oiRows);
    await this.writers.longShort.write(lsRows);
    this.streams.recordMessage(STREAM_ID, at);

    if (failed.length > 0) {
      await this.recordGaps(slot, slot, failed, `poll failed for ${failed.length} symbol(s)`);
    }
    return { oi: oiRows.length, longShort: lsRows.length, failed };
  }

  // -------------------------------------------------------------------------------------------
  // Boot backfill
  // -------------------------------------------------------------------------------------------

  /**
   * §4.1 — "on boot, the poller backfills the venue's 30-day window for every symbol whose last
   * stored row is older than 5 minutes". Pages backward by `endTime`; the venue's `-1130` is the
   * retention edge and ends a symbol's walk cleanly.
   */
  async backfill(now = Date.now()): Promise<{ symbols: number; oi: number; longShort: number }> {
    const from = now - RETENTION_MS + SLOT_MS; // one slot inside the edge, so the last page is not a guaranteed -1130

    // §3.1 — "backfill creates partitions for every month it touches". Boot maintenance only
    // prepares the current month and three ahead, so a 30-day window reaching into last month
    // has nowhere to land. Without this the first backfill dies on `no partition of relation
    // "open_interest_5m" found for row` — which is the schema working as designed (IB-004: no
    // DEFAULT partition), and is how this was caught on the first live run.
    await this.partitions.ensureRange(new Date(from), new Date(now));

    const stale = await this.staleSymbols(now);
    let oi = 0;
    let longShort = 0;

    for (const symbol of stale) {
      const oiRaw = await this.client.fetchBackward<OpenInterestHistRow>(
        { endpoint: 'openInterestHist', symbol, period: PERIOD, limit: PAGE_LIMIT }, from, now,
        () => this.pace(),
      );
      oi += await this.writers.openInterest.write(mapOpenInterestHist(oiRaw, symbol, 'rest'));

      for (const { endpoint, kind } of ACCOUNT_RATIO_ENDPOINTS) {
        const raw = await this.client.fetchBackward<LongShortAccountRow>(
          { endpoint, symbol, period: PERIOD, limit: PAGE_LIMIT }, from, now, () => this.pace(),
        );
        longShort += await this.writers.longShort.write(mapLongShortAccount(raw, symbol, kind, 'rest'));
      }
      const taker = await this.client.fetchBackward<TakerRatioRow>(
        { endpoint: 'takerlongshortRatio', symbol, period: PERIOD, limit: PAGE_LIMIT }, from, now, () => this.pace(),
      );
      longShort += await this.writers.longShort.write(mapTakerRatio(taker, symbol, 'rest'));

      // Whatever the venue did not return inside the window is a gap, recorded per symbol so
      // §6.2's daily report can count it rather than silently showing a complete grid.
      const stored = await this.storedSlots(symbol, from, now);
      await this.recordMissing(symbol, from, now, stored);
    }

    this.logger.log(`OI/LS backfill: ${stale.length} symbol(s), ${oi} OI rows, ${longShort} long/short rows.`);
    return { symbols: stale.length, oi, longShort };
  }

  private async pace(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, BACKFILL_PACING_MS));
  }

  /** Symbols whose newest stored OI slot is older than one slot, or which have none at all. */
  private async staleSymbols(now: number): Promise<string[]> {
    const rows = await this.db.query<{ symbol: string; last: Date | null }>(
      `select s.binance_perp as symbol, max(o.ts) as last
         from symbols s left join open_interest_5m o on o.symbol = s.binance_perp and o.venue = $1
        where s.active
        group by s.binance_perp`,
      [VENUE],
    );
    const cutoff = now - SLOT_MS;
    return rows.filter((row) => row.last === null || row.last.getTime() < cutoff).map((row) => row.symbol);
  }

  private async storedSlots(symbol: string, from: number, to: number): Promise<Date[]> {
    const rows = await this.db.query<{ ts: Date }>(
      'select ts from open_interest_5m where venue = $1 and symbol = $2 and ts >= $3 and ts <= $4',
      [VENUE, symbol, new Date(from), new Date(to)],
    );
    return rows.map((row) => row.ts);
  }

  /**
   * Gaps *inside* what the venue served, not at its edges.
   *
   * The retention edge drifts continuously — by the time a page comes back, `now - 30 days` has
   * moved on — so the oldest slot we asked for is routinely one the venue no longer publishes.
   * Measured on the first live run: every symbol reported exactly one "missing" slot, always the
   * window's first. That is the boundary, not lost data, and recording it would put 30 phantom
   * gaps a day into §6.2's report and bury the real ones.
   *
   * So the grid is checked from the oldest slot actually returned. A symbol that returned
   * **nothing at all** has no edge to anchor to and is recorded as one gap over the whole window,
   * which is a real failure and must stay visible.
   */
  private async recordMissing(symbol: string, from: number, to: number, stored: readonly Date[]): Promise<void> {
    if (stored.length === 0) {
      await this.writeGaps([{ from, to, expected: Math.round((to - from) / SLOT_MS) + 1 }], symbol, 'the venue returned no rows for this symbol');
      return;
    }
    const oldestServed = Math.min(...stored.map((ts) => ts.getTime()));
    const ranges = missingRanges(oldestServed, to, stored);
    if (ranges.length === 0) return;
    await this.writeGaps(ranges, symbol, 'not returned by the venue inside its retention window');
  }

  /** One `collector_gaps` row per range, counted on the metric and reflected in `/health`. */
  private async writeGaps(
    ranges: ReadonlyArray<{ from: number; to: number; expected: number }>,
    symbol: string,
    error: string,
  ): Promise<void> {
    if (ranges.length === 0) return;
    const gaps: CollectorGapRow[] = ranges.map((range) => ({
      stream: STREAM_ID,
      venue: VENUE,
      market: 'perp',
      symbol,
      gapFrom: new Date(range.from),
      gapTo: new Date(range.to),
      expected: range.expected,
      repaired: 0,
      error,
      detectedAt: new Date(),
    }));
    await this.writers.collectorGaps.write(gaps);
    gaps.forEach(() => this.metrics.gapsDetected.inc({ stream: STREAM_ID }));
    this.streams.setGapsOpen(STREAM_ID, ranges.length);
  }

  private async recordGaps(from: number, to: number, symbols: readonly string[], error: string): Promise<void> {
    await this.writers.collectorGaps.write(
      symbols.map((symbol) => ({
        stream: STREAM_ID, venue: VENUE, market: 'perp' as const, symbol,
        gapFrom: new Date(from), gapTo: new Date(to), expected: 1, repaired: 0, error,
        detectedAt: new Date(),
      })),
    );
    symbols.forEach(() => this.metrics.gapsDetected.inc({ stream: STREAM_ID }));
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

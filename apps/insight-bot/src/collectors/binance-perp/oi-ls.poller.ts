import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { Db, DB } from '../../db/db.port';
import { PartitionMaintenanceService } from '../../db/partitions.service';
import { MetricsService } from '../../ops/metrics.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { Writers } from '../writers/batch-writer';
import { CollectorGapRow, LongShortRow, OpenInterestRow } from '../writers/tables';
import { BinanceWeightTracker } from '../../venues/binance/binance-weight.tracker';
import { FuturesDataClient, PAGE_LIMIT, RETENTION_MS } from '../../venues/binance/futures-data.client';
import {
  ACCOUNT_RATIO_ENDPOINTS,
  LongShortAccountRow,
  mapLongShortAccount,
  mapOpenInterestHist,
  mapTakerRatio,
  OpenInterestHistRow,
  TakerRatioRow,
  VENUE,
} from '../../venues/binance/oi-ls.mapper';
import { OpenWindow, splitOpen } from './gap-classifier';
import { GapRange, planGaps, RegisteredGap } from './gap-ledger';
import { missingRanges, nextPollAt, SLOT_MS, slotForPoll, slotOf } from './slot-grid';

export const STREAM_ID = 'binance-perp:oi-ls-5m';
const PERIOD = '5m';

/**
 * architecture/insight-bot-system-design.md §4.1, §4.5 — OI and the four long/short series at
 * 5 m, polled at every 5-minute boundary **+ 20 s** (the venue publishes on the boundary with a
 * lag), for every active universe symbol.
 *
 * **REST cost: 5 calls × 30 symbols per 5 min = 150 calls per 5 min, and 0 weight.**
 * `/futures/data/*` is «IP Weight 0» on Binance's 2400 weight/min (IB-BUG-030: docs + measured, see
 * `CALL_WEIGHT`); it spends a separate per-IP limit of **1000 requests / 5 min per endpoint**, of
 * which a steady pass uses 30 per endpoint (3 %). Until IB-BUG-030 this said "30 weight/min, 1.25 %
 * of 2400" and the tracker booked each call at 1, so `ib_binance_weight_used_1m` read ~150 during a
 * pass that cost the weight budget nothing.
 *
 * The boot backfill is a one-off on top: at most ⌈30 days / (500 slots × 5 min)⌉ = 18 pages per
 * series per symbol, 5 × 18 × 30 = 2700 calls, paced at `BACKFILL_PACING_MS`. **That pacing is the
 * only thing near a limit: 120 ms = 500 calls/min over 5 endpoints ≈ 500 per endpoint per 5 min,
 * half of the 1000/5min — arithmetic, not measured.** Nothing gauges that limit; if a 429/418 ever
 * shows on `/futures/data`, that is when it earns one.
 *
 * These endpoints send no `X-MBX-USED-WEIGHT-1M` header (measured — see
 * `futures-data.client.ts`) and cost no weight, so this loop alone leaves
 * `ib_binance_weight_used_1m` at 0; the gauge reads what the `/fapi` traffic spends.
 *
 * **IB-109 (OI divergence design V3): the symbols are the universe ∪ the ENABLED `alert_symbols`**,
 * re-read from the database at the start of every pass — not snapshotted at boot — so a coin added
 * on the admin page is collected from the next pass, without a deploy. A coin seen for the first
 * time with no fresh OI gets the same 30-day backfill the boot runs, for that one coin, queued so two
 * backfills never run at once. A coin removed from the list is no longer polled; its rows stay.
 * Cost: +5 requests per extra coin per pass (one per endpoint, weight 0) — TRX, the one listed coin
 * outside the universe today, is +1 of 1000 per endpoint per 5 min — and one backfill of
 * 5 × ⌈30 d / 500 slots⌉ = 90 paced requests when it first appears.
 */
export const BACKFILL_PACING_MS = 120;

/**
 * Rows fetched per series per poll.
 *
 * §4.1 says the venue "publishes on the boundary with a lag", which the +20 s offset is meant to
 * absorb. It does not always absorb it.
 *
 * **The load-bearing evidence is the live collector, not a hand probe** (AGENTS.md: a rule needs
 * repetition; this is 30 symbols in one pass rather than one symbol once). On 2026-09-28 the
 * 14:50 slot held **7 of 30 symbols** right after its own poll at boundary + 20 s, and **30 of
 * 30** after the next pass. The first run showed the same shape: 23 symbols on 13:45, 8 on 13:50.
 *
 * Sampling the lag directly, the picture is intermittent rather than constant — 8 symbols probed
 * at 21:12 UTC: **1 of 8 lagging at 128 s past the boundary (XRPUSDT), 0 of 8 at 152 s**; an
 * earlier single probe at 169 s caught BTCUSDT behind. So **which** symbol lags moves around,
 * which is the point: you cannot predict it, so you cannot safely fetch only the newest row.
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
  /** IB-109: the symbols of the latest pass (universe ∪ listed), and those already backfilled or found fresh. */
  private current: string[] = [];
  private readonly seen = new Set<string>();
  /** Set once the boot backfill has taken its list: before that, every symbol is the boot's to cover, not «new». */
  private bootListed = false;
  /** One per-symbol backfill at a time, in the order the symbols appeared. */
  private backfillQueue: Promise<unknown> = Promise.resolve();

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
    this.streams.register(STREAM_ID, VENUE, SLOT_MS / 1000); // a 5-minute poller, not a socket
    // Read live at scrape time, so the gauge decays with the trailing minute instead of holding
    // the last poll's figure for five minutes.
    this.metrics.setBinanceWeightSource(() => this.weight.used1m());
  }

  /**
   * `onApplicationBootstrap`, not `onModuleInit`: the partitions must exist before anything
   * writes, and `DbModule.onModuleInit` is what creates them (§3.1). The backfill is
   * fire-and-forget — it takes minutes across 30 symbols and must not hold up the listener or
   * the admin health page (`/api/web/health/streams`), which is how its progress is watched.
   */
  onApplicationBootstrap(): void {
    this.start();
    void this.backfill().catch((err) => this.logger.error(`OI/LS boot backfill failed: ${(err as Error).message}`));
  }

  /** The active universe symbols, by their Binance USD-M symbol (§2.3). */
  private universe(): string[] {
    return this.config.symbols.map((s) => s.binance_perp);
  }

  /**
   * IB-109 (V3): universe ∪ the enabled alert-list coins, read now. If the list cannot be read, the
   * previous pass's list stands (a database hiccup must not stop collecting a listed coin).
   */
  async collectSymbols(): Promise<string[]> {
    let listed: string[];
    try {
      listed = (await this.db.query<{ symbol: string }>('select symbol from alert_symbols where enabled order by symbol', [])).map((r) => r.symbol);
    } catch (err) {
      this.logger.warn(`OI/LS: alert_symbols unreadable, keeping the last list: ${(err as Error).message}`);
      listed = this.current.filter((s) => !this.universe().includes(s));
    }
    this.current = [...new Set([...this.universe(), ...listed])];
    return this.current;
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
    const symbols = await this.collectSymbols();
    this.queueBackfillForNew(symbols, at);

    for (const symbol of symbols) {
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

    const symbols = await this.collectSymbols();
    symbols.forEach((s) => this.seen.add(s)); // the boot backfill covers every symbol it can see now
    this.bootListed = true;
    const stale = await this.staleSymbols(now, symbols);
    const done = await this.backfillSymbols(stale, from, now);
    // IB-BUG-020: every open window of the stream, not the last symbol's count. IB-104: split by
    // whose fault it is (`gap-classifier.ts`), so the venue's closed sessions do not paint the row.
    const split = splitOpen(await this.openWindows(from), this.current.length - 1);
    this.streams.setGapsOpen(STREAM_ID, split.ours, split.venue);

    this.logger.log(`OI/LS backfill: ${stale.length} symbol(s), ${done.oi} OI rows, ${done.longShort} long/short rows.`);
    return { symbols: stale.length, oi: done.oi, longShort: done.longShort };
  }

  /**
   * IB-109 (V3): a symbol this pass sees for the first time gets the boot's 30-day backfill if its OI
   * is stale or absent — queued behind any running one, fire-and-forget, so the pass itself is not
   * held up by 90 paced requests. Returns the queue's tail, for the specs.
   */
  queueBackfillForNew(symbols: readonly string[], now: number): Promise<unknown> {
    // a pass that lands before the boot backfill has listed its symbols must not backfill them a second time
    if (!this.bootListed) return this.backfillQueue;
    const fresh = symbols.filter((s) => !this.seen.has(s));
    if (fresh.length === 0) return this.backfillQueue;
    fresh.forEach((s) => this.seen.add(s));
    this.backfillQueue = this.backfillQueue.then(async () => {
      const from = now - RETENTION_MS + SLOT_MS;
      await this.partitions.ensureRange(new Date(from), new Date(now));
      const stale = await this.staleSymbols(now, fresh);
      const started = Date.now();
      const done = await this.backfillSymbols(stale, from, now);
      if (stale.length > 0) {
        this.logger.log(`OI/LS backfill for newly listed ${stale.join(', ')}: ${done.oi} OI rows, ${done.longShort} long/short rows in ${Math.round((Date.now() - started) / 100) / 10} s.`);
      }
    }).catch((err) => this.logger.error(`OI/LS backfill for ${fresh.join(', ')} failed: ${(err as Error).message}`));
    return this.backfillQueue;
  }

  /** The per-symbol 30-day walk, shared by the boot and by a newly listed coin. */
  private async backfillSymbols(stale: readonly string[], from: number, now: number): Promise<{ oi: number; longShort: number }> {
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
    return { oi, longShort };
  }

  private async pace(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, BACKFILL_PACING_MS));
  }

  /**
   * Of `symbols`, those whose newest stored OI slot is older than one slot, or which have none at all.
   * IB-109: over the list it is given (universe ∪ listed), not the universe table — a listed coin is
   * not in `symbols`.
   */
  private async staleSymbols(now: number, symbols: readonly string[]): Promise<string[]> {
    const rows = await this.db.query<{ symbol: string; last: Date | null }>(
      `select s.sym as symbol, max(o.ts) as last
         from unnest($2::text[]) as s(sym) left join open_interest_5m o on o.symbol = s.sym and o.venue = $1
        group by s.sym`,
      [VENUE, [...symbols]],
    );
    const cutoff = now - SLOT_MS;
    return rows.filter((row) => symbols.includes(row.symbol) && (row.last === null || row.last.getTime() < cutoff)).map((row) => row.symbol);
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
    const storedMs = stored.map((ts) => ts.getTime());
    let found: GapRange[];
    let error: string;
    if (stored.length === 0) {
      found = [{ from, to, expected: Math.round((to - from) / SLOT_MS) + 1 }];
      error = 'the venue returned no rows for this symbol';
    } else {
      // IB-BUG-020: the trailing edge, as the retention edge above. The newest POLL_LIMIT slots may
      // not be published yet at boot (the venue's per-symbol lag); the 5-minute loop asks for exactly
      // those. Recording them was a phantom gap per boot (QQQUSDT 18:00 on the box, stored minutes
      // later). A symbol the venue stopped serving earlier than that is still reported.
      const pollReach = slotOf(to) - POLL_LIMIT * SLOT_MS;
      found = missingRanges(Math.min(...storedMs), Math.max(Math.max(...storedMs), pollReach), stored);
      error = 'not returned by the venue inside its retention window';
    }
    // IB-BUG-020: written once, repaired when the slots arrive (`gap-ledger.ts`)
    const plan = planGaps(found, await this.registeredGaps(symbol, from, to), storedMs);
    for (const r of plan.repairs) {
      await this.db.query('update collector_gaps set repaired = $3 where id = $1 and detected_at = $2', [r.id, r.detectedAt, r.repaired]);
    }
    await this.writeGaps(plan.insert, symbol, error);
  }

  /**
   * IB-104 — every open window of this stream inside the venue's window, distinct, with the evidence
   * the classifier needs: in its emptiest slot, how many OTHER active symbols had OI stored. One
   * query at the end of the boot backfill. On the box that is ~240 windows and ~3 000 slots, each an
   * index probe on the primary key (venue, symbol, ts), and no venue call.
   */
  private async openWindows(from: number): Promise<OpenWindow[]> {
    const rows = await this.db.query<{ error: string | null; min_neighbours: string | number }>(
      `with w as (
         select distinct symbol, gap_from, gap_to, error
           from collector_gaps
          where stream = $1 and detected_at >= $2 and gap_to >= $2 and repaired < expected
       ), slots as (
         select w.symbol, w.gap_from, w.gap_to, w.error, gs.slot
           from w cross join lateral generate_series(w.gap_from, w.gap_to, interval '5 minutes') as gs(slot)
       )
       select s.error,
              min((select count(*) from open_interest_5m o
                    where o.venue = $3 and o.ts = s.slot and o.symbol = any($4) and o.symbol <> s.symbol)) as min_neighbours
         from slots s
        group by s.symbol, s.gap_from, s.gap_to, s.error`,
      [STREAM_ID, new Date(from), VENUE, this.current],
    );
    return rows.map((r) => ({ error: r.error, minNeighboursStored: Number(r.min_neighbours) }));
  }

  /**
   * IB-BUG-020 — this stream's rows for `symbol` that touch the window. `detected_at >= from` is
   * exact, not a guess: a gap ending inside the window was detected after it ended. It also lets
   * Postgres skip the older monthly partitions (`collector_gaps` is partitioned by `detected_at`).
   */
  private async registeredGaps(symbol: string, from: number, to: number): Promise<RegisteredGap[]> {
    const rows = await this.db.query<{ id: string; detected_at: Date; gap_from: Date; gap_to: Date; expected: number; repaired: number }>(
      `select id, detected_at, gap_from, gap_to, expected, repaired
         from collector_gaps
        where stream = $1 and symbol = $2 and detected_at >= $3 and gap_to >= $3 and gap_from <= $4`,
      [STREAM_ID, symbol, new Date(from), new Date(to)],
    );
    return rows.map((r) => ({
      id: String(r.id), detectedAt: new Date(r.detected_at), gapFrom: new Date(r.gap_from).getTime(),
      gapTo: new Date(r.gap_to).getTime(), expected: Number(r.expected), repaired: Number(r.repaired),
    }));
  }

  /** One `collector_gaps` row per range, counted on the metric and reflected in the admin health page (`/api/web/health/streams`). */
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

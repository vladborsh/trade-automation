import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  WEB_LIQUIDATION_BUCKET_SECONDS, WEB_LIQUIDATION_MIN_HISTORY_DAYS, WEB_LIQUIDATION_WINDOWS, WEB_LIQUIDATION_WINDOW_SECONDS,
  WEB_LIQUIDATION_NORM_DAYS, WEB_LIQUIDATION_VENUES, WEB_MARKET_PERIOD_SECONDS,
  type WebLiquidationBlock, type WebLiquidationCoin, type WebLiquidationsOverviewResponse, type WebMarketPeriod,
} from '@trade-automation/contracts';
import { DB, type Db } from '../../db/db.port';
import { LARGE_LIMIT, LARGE_MIN_USD, LIQUIDATION_BLOCK_CACHE_MS, SERIES_MIN_USD } from '../../insights/thresholds';
import { IDLE_SWEEP_MS, TtlCache } from '../../venues/ttl-cache';
import { AssetClassifier } from './asset-classes';
import { availableFrom, hourly, largeEvents, otherCoins, periodNorm, periodTotals, verdict } from './block.assemble';
import { normPeriodStart } from './norm';
import { completeWindowStarts, sampleFor, windowStats } from './overview.assemble';
import * as repo from './pg/overview.repo';

/**
 * IB-038 — `GET /api/web/liquidations/overview` (§12.3).
 *
 * **The venues this deployment collects liquidations from.** `missing` is this list minus the
 * venues that actually wrote rows, which is how §12.4's «Binance: нет данных» reaches the page
 * as evidence rather than as a hard-coded sentence: Binance is REST-degraded here and has no
 * `forceOrder`, so it writes nothing and appears as missing on its own.
 */
export const LIQUIDATION_VENUES = WEB_LIQUIDATION_VENUES;

/**
 * §12.3: several members polling must not multiply the query. IB-084 (D8) lowers it from 15 s to
 * the block's 5 s, keyed per period: the market page polls liquidations every 10 s (D13).
 */
export const OVERVIEW_CACHE_MS = LIQUIDATION_BLOCK_CACHE_MS;

/** The `venue:symbol` classification of what is in the norm period changes slowly: a minute. */
export const CLASS_KEYS_CACHE_MS = 60_000;

export interface OverviewQuery {
  topN: number;
  feedMinUsd: number;
  feedLimit: number;
  /** IB-084: the block's period (D14); 24h keeps the IB-038 fields exactly as before. */
  period: WebMarketPeriod;
}

/** IB-086: what the liquidation rules read (see `marketSamples`). */
export interface MarketSamples {
  long: { usd: number; sample: number[] };
  short: { usd: number; sample: number[] };
  /** Length of the period sample in days (0 for 7d, D14). */
  days: number;
  /** Complete hourly totals over the norm period, empty hours 0. */
  hourly: number[];
  hourlyDays: number;
  venues: string[];
  fromMs: number | null;
}

interface ClassKeys {
  crypto: string[];
  tradfi: string[];
  unknown: string[];
}

@Injectable()
export class LiquidationsOverviewService {
  /**
   * Keyed by the parameters that change the answer, and holding the **promise** rather than the
   * value: two members arriving in the same 50 ms should share one query, not start two and race
   * to fill the slot.
   */
  private readonly cache: TtlCache;

  constructor(
    @Inject(DB) private readonly db: Db | null,
    private readonly classifier: AssetClassifier,
    /** Injected so the cache's expiry is spec'able without sleeping. `@Optional()` or Nest fails to resolve it. */
    @Optional() private readonly now: () => number = () => Date.now(),
  ) {
    this.cache = new TtlCache({ now: () => this.now(), name: 'liquidations', idleSweepMs: IDLE_SWEEP_MS });
  }

  async overview(q: OverviewQuery): Promise<WebLiquidationsOverviewResponse> {
    const key = `overview:${q.period}:${q.topN}:${q.feedMinUsd}:${q.feedLimit}`;
    // the promise is shared by everyone asking in the same 5 s; a failure is not cached
    return this.cache.getOrLoad(key, OVERVIEW_CACHE_MS, () => this.compute(q, this.now()));
  }

  /** IB-084 D6: every `venue:symbol` in the norm period, split by class (cached a minute). */
  private classKeys(db: Db, nowMs: number): Promise<ClassKeys> {
    return this.cache.getOrLoad('class-keys', CLASS_KEYS_CACHE_MS, async () => {
      await this.classifier.ready();
      const present = await repo.distinctKeys(db, { fromMs: nowMs - WEB_LIQUIDATION_NORM_DAYS * 86_400_000, toMs: nowMs + 60_000 });
      const out: ClassKeys = { crypto: [], tradfi: [], unknown: [] };
      for (const { venue, symbol } of present) out[this.classifier.classify(venue, symbol)].push(`${venue}:${symbol}`);
      return out;
    });
  }

  /**
   * IB-120: the crypto `venue:symbol` keys and the alias map — the scope every Market total uses
   * (D6, IB-BUG-025), for the /liquidations page to read the same population.
   */
  async cryptoScope(nowMs: number): Promise<{ keys: string[]; aliases: ReturnType<AssetClassifier['aliases']> }> {
    const db = this.db;
    if (!db) throw new Error('no database');
    const keys = await this.classKeys(db, nowMs);
    return { keys: keys.crypto, aliases: this.classifier.aliases() };
  }

  /** IB-BUG-025: the coin of an unmapped row's `venue:symbol` (Binance base asset when known). */
  private coinOfKey(venueKey: string | null): string {
    if (venueKey === null) return 'unknown';
    const at = venueKey.indexOf(':');
    return this.classifier.coinOf(venueKey.slice(0, at), venueKey.slice(at + 1));
  }

  /**
   * IB-085 (D9): per CRYPTO coin, the period's USD and the sample it is rare against — one sum per
   * complete aligned window of the period's length over the norm period, empty windows as 0. `days`
   * is that sample's length in days, so the caller can refuse under its minimum. 7d gives no sample
   * (D14). Cached with the overview's 5 s.
   */
  async coinPeriodSamples(period: WebMarketPeriod): Promise<Map<string, { usd: number; sample: number[]; days: number }>> {
    return this.cache.getOrLoad(`coin-samples:${period}`, OVERVIEW_CACHE_MS, async () => {
      const db = this.db;
      if (!db) throw new Error('no database');
      const nowMs = this.now();
      const keys = await this.classKeys(db, nowMs);
      const aliases = this.classifier.aliases();
      const periodSec = WEB_MARKET_PERIOD_SECONDS[period];
      const capMs = nowMs - WEB_LIQUIDATION_NORM_DAYS * 86_400_000;
      const [firstSeen, trailing, buckets] = await Promise.all([
        repo.venueFirstSeen(db, { fromMs: capMs, toMs: nowMs, keys: keys.crypto, aliases }),
        repo.trailingSums(db, { nowMs, windowsSec: [periodSec], keys: keys.crypto, aliases }),
        period === '7d' ? Promise.resolve([]) : repo.alignedBuckets(db, { windowSec: periodSec, fromMs: capMs, toMs: nowMs, keys: keys.crypto, aliases }),
      ]);
      const out = new Map<string, { usd: number; sample: number[]; days: number }>();
      const ids = new Set(trailing.map((r) => r.symbolId).concat(firstSeen.map((r) => r.symbolId)).filter((id): id is string => id !== null));
      for (const id of ids) {
        const rows = firstSeen.filter((r) => r.symbolId === id);
        const venues = [...new Set(rows.map((r) => r.venue))];
        const start = normPeriodStart(venues.map((v) => Math.min(...rows.filter((r) => r.venue === v).map((r) => r.firstSeenMs))), nowMs);
        const starts = period === '7d' ? [] : completeWindowStarts(start, nowMs, periodSec);
        out.set(id, {
          usd: periodTotals(trailing, periodSec, id).usd,
          sample: sampleFor(buckets.filter((b) => b.symbolId === id), starts, null),
          days: (starts.length * periodSec) / 86_400,
        });
      }
      return out;
    });
  }

  /**
   * IB-086 (R1, R3): market-wide CRYPTO samples for one period — per side, the trailing USD and one
   * sum per complete aligned window of the period's length (empty windows 0); plus the hourly totals
   * over the same norm period, which R3 compares a cascade against. 7d gives no period sample (D14).
   */
  async marketSamples(period: WebMarketPeriod): Promise<MarketSamples> {
    return this.cache.getOrLoad(`market-samples:${period}`, OVERVIEW_CACHE_MS, async () => {
      const db = this.db;
      if (!db) throw new Error('no database');
      const nowMs = this.now();
      const keys = await this.classKeys(db, nowMs);
      const aliases = this.classifier.aliases();
      const periodSec = WEB_MARKET_PERIOD_SECONDS[period];
      const capMs = nowMs - WEB_LIQUIDATION_NORM_DAYS * 86_400_000;
      const [firstSeen, trailing, periodBuckets, hourBuckets] = await Promise.all([
        repo.venueFirstSeen(db, { fromMs: capMs, toMs: nowMs, keys: keys.crypto, aliases }),
        repo.trailingSums(db, { nowMs, windowsSec: [periodSec], keys: keys.crypto, aliases }),
        period === '7d' ? Promise.resolve([]) : repo.alignedBuckets(db, { windowSec: periodSec, fromMs: capMs, toMs: nowMs, keys: keys.crypto, aliases }),
        repo.alignedBuckets(db, { windowSec: 3_600, fromMs: capMs, toMs: nowMs, keys: keys.crypto, aliases }),
      ]);
      const venues = [...new Set(firstSeen.map((r) => r.venue))];
      const start = normPeriodStart(venues.map((v) => Math.min(...firstSeen.filter((r) => r.venue === v).map((r) => r.firstSeenMs))), nowMs);
      const starts = period === '7d' ? [] : completeWindowStarts(start, nowMs, periodSec);
      const hourStarts = completeWindowStarts(start, nowMs, 3_600);
      const totals = periodTotals(trailing, periodSec);
      return {
        long: { usd: totals.long, sample: sampleFor(periodBuckets, starts, 'long') },
        short: { usd: totals.short, sample: sampleFor(periodBuckets, starts, 'short') },
        days: (starts.length * periodSec) / 86_400,
        hourly: sampleFor(hourBuckets, hourStarts, null),
        hourlyDays: hourStarts.length / 24,
        venues: venues.sort(),
        fromMs: starts.length > 0 ? starts[0] : hourStarts[0] ?? null,
      };
    });
  }

  private async compute(q: OverviewQuery, nowMs: number): Promise<WebLiquidationsOverviewResponse> {
    const db = this.db;
    if (!db) throw new Error('no database');
    // D6: every total, norm and rank below is CRYPTO only
    const keys = await this.classKeys(db, nowMs);
    const crypto = keys.crypto;
    // IB-BUG-025: another quote/form of a universe coin counts in its row (BTCUSDC → BTC)
    const aliases = this.classifier.aliases();

    const widestSec = Math.max(...Object.values(WEB_LIQUIDATION_WINDOW_SECONDS));
    const capMs = nowMs - WEB_LIQUIDATION_NORM_DAYS * 86_400_000;

    // `venueFirstSeen` is bounded to the cap, so a venue older than the period reports the cap
    // and `normPeriodStart` leaves the period at its full length.
    const [firstSeen, feedRows, present, ranked] = await Promise.all([
      repo.venueFirstSeen(db, { fromMs: capMs, toMs: nowMs, keys: crypto, aliases }),
      repo.feed(db, { fromMs: nowMs - widestSec * 1000, toMs: nowMs, minUsd: q.feedMinUsd, limit: q.feedLimit, keys: crypto, aliases }),
      repo.venuesWithRows(db, { fromMs: nowMs - widestSec * 1000, toMs: nowMs }),
      // D6: ranks are crypto only — TradFi ids are dropped before the top N is cut
      repo.rankedSymbols(db, q.topN + 50).then((rows) => rows.filter((r) => this.classifier.classOfId(r.id) === 'crypto').slice(0, q.topN)),
    ]);

    /**
     * The norm period is **per scope**, not one period for the whole page.
     *
     * §12.2 says "null until 7 days of history exist **for that scope**", and §12.4's venue-set
     * rule is likewise about the venues that scope has. Computing it once market-wide lets a coin
     * borrow another coin's history: caught by the integration spec, where ETH — twelve days of
     * Bybit and half an hour of OKX — reported a ratio of 6 because BTC's OKX history had set a
     * twelve-day period for everything. That is exactly the faked spike §12.4 exists to prevent.
     */
    const scopeOf = (symbolId: string | null) => {
      const rows = symbolId === null ? firstSeen : firstSeen.filter((r) => r.symbolId === symbolId);
      const venues = [...new Set(rows.map((r) => r.venue))];
      const perVenueFirst = venues.map((v) => Math.min(
        ...rows.filter((r) => r.venue === v).map((r) => r.firstSeenMs),
      ));
      return { venues, periodStartMs: normPeriodStart(perVenueFirst, nowMs) };
    };

    /** The widest period any scope uses, so one bucket query covers them all. */
    const periodStartMs = Math.min(
      scopeOf(null).periodStartMs,
      ...ranked.map((c) => scopeOf(c.id).periodStartMs),
    );

    const periodSec = WEB_MARKET_PERIOD_SECONDS[q.period];
    const bucketSec = WEB_LIQUIDATION_BUCKET_SECONDS[q.period];
    const trailingWindows = [...new Set([...WEB_LIQUIDATION_WINDOWS.map((w) => WEB_LIQUIDATION_WINDOW_SECONDS[w]), periodSec])];
    const [trailing, tradfiTrailing, unknownTrailing] = await Promise.all([
      repo.trailingSums(db, { nowMs, windowsSec: trailingWindows, keys: crypto, aliases }),
      repo.trailingSums(db, { nowMs, windowsSec: [periodSec], keys: keys.tradfi }),
      repo.trailingSums(db, { nowMs, windowsSec: [periodSec], keys: keys.unknown }),
    ]);
    // one pass per window size, as §12.3 budgets — plus the block's bar length and period length
    const sizes = [...new Set([...WEB_LIQUIDATION_WINDOWS.map((w) => WEB_LIQUIDATION_WINDOW_SECONDS[w]), bucketSec, ...(q.period === '7d' ? [] : [periodSec])])];
    const barsFromMs = Math.min(periodStartMs, nowMs - (periodSec + bucketSec) * 1000);
    const bucketsBySize = new Map(await Promise.all(
      sizes.map(async (windowSec) => [
        windowSec,
        await repo.alignedBuckets(db, { windowSec, fromMs: windowSec === bucketSec ? barsFromMs : periodStartMs, toMs: nowMs, keys: crypto, aliases }),
      ] as const),
    ));
    const bucketsByWindow = new Map(WEB_LIQUIDATION_WINDOWS.map((w) => [w, bucketsBySize.get(WEB_LIQUIDATION_WINDOW_SECONDS[w]) ?? []] as const));

    const statsFor = (symbolId: string | null) => {
      const scope = scopeOf(symbolId);
      return WEB_LIQUIDATION_WINDOWS.map((w) => windowStats({
        window: w,
        windowSec: WEB_LIQUIDATION_WINDOW_SECONDS[w],
        nowMs,
        // this scope's own period, which may be far shorter than the query's
        periodStartMs: scope.periodStartMs,
        buckets: bucketsByWindow.get(w) ?? [],
        trailing,
        symbolId,
        venues: scope.venues,
      }));
    };

    const perCoin: WebLiquidationCoin[] = ranked.map((coin) => ({
      symbol: coin.id,
      base: coin.base,
      windows: statsFor(coin.id),
    }));

    // ---- IB-084: the block for `period` ------------------------------------------------------
    const market = scopeOf(null);
    const periodBuckets = bucketsBySize.get(periodSec) ?? [];
    const scopedNorm = (symbolId: string | null) => {
      const scope = scopeOf(symbolId);
      const totals = periodTotals(trailing, periodSec, symbolId);
      const norm = periodNorm({
        period: q.period, totals, nowMs, periodStartMs: scope.periodStartMs, venues: scope.venues,
        buckets: symbolId === null ? periodBuckets : periodBuckets.filter((b) => b.symbolId === symbolId),
      });
      return { totals, norm };
    };
    const marketNorm = scopedNorm(null);
    const candidates = await repo.feed(db, {
      fromMs: nowMs - periodSec * 1000, toMs: nowMs, minUsd: Math.min(LARGE_MIN_USD, SERIES_MIN_USD), limit: 5_000, keys: crypto, order: 'oldest', aliases,
    });
    const medianEvent = await repo.medianEventUsd(db, { fromMs: market.periodStartMs, toMs: nowMs, keys: crypto });
    const marketPeriodDays = (nowMs - market.periodStartMs) / 86_400_000;
    const firstSeenMs = firstSeen.length === 0 ? null : Math.min(...firstSeen.map((r) => r.firstSeenMs));

    const block: WebLiquidationBlock = {
      period: q.period,
      totals: marketNorm.totals,
      basis: marketNorm.norm.basis,
      hourly: hourly({
        periodSec, bucketSec, nowMs, buckets: bucketsBySize.get(bucketSec) ?? [], periodStartMs: market.periodStartMs, venues: market.venues,
      }),
      perCoin: ranked.map((coin) => {
        const { totals, norm } = scopedNorm(coin.id);
        return { symbol: coin.id, base: coin.base, totals, verdict: verdict(norm), basis: norm.basis };
      }),
      large: largeEvents({
        events: candidates, minUsd: LARGE_MIN_USD, limit: LARGE_LIMIT, medianEventUsd: medianEvent,
        normPeriodDays: marketPeriodDays, minHistoryDays: WEB_LIQUIDATION_MIN_HISTORY_DAYS,
      }),
      largeMinUsd: LARGE_MIN_USD,
      // IB-BUG-025: the crypto in no row, so rows + this = totals
      otherCoins: otherCoins(trailing, periodSec, new Set(ranked.map((c) => c.id)), (r) => r.symbolId ?? this.coinOfKey(r.venueKey)),
      tradfi: periodTotals(tradfiTrailing, periodSec),
      unknown: periodTotals(unknownTrailing, periodSec),
      // the 30-day cap bounds `firstSeen`; a box older than that is long past every period anyway
      availableFrom: availableFrom(firstSeenMs, nowMs),
    };

    return {
      asOf: Math.floor(nowMs / 1000),
      block,
      windows: statsFor(null),
      perCoin,
      feed: feedRows.map((r) => ({
        time: r.timeSec,
        // an unmapped event keeps the venue's own spelling rather than vanishing from the feed
        symbol: r.symbolId ?? r.venueSymbol,
        base: r.base ?? r.venueSymbol,
        side: r.side,
        usd: r.usd,
        price: r.price,
        venue: r.venue,
      })),
      feedMinUsd: q.feedMinUsd,
      venues: {
        present: [...present].sort(),
        missing: LIQUIDATION_VENUES.filter((v) => !present.includes(v)),
      },
      unmappedRows: trailing
        .filter((r) => r.symbolId === null)
        .reduce((sum, r) => sum + (r.eventsByWindow[widestSec] ?? 0), 0),
    };
  }
}

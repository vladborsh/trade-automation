import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  WEB_LIQUIDATION_WINDOWS, WEB_LIQUIDATION_WINDOW_SECONDS, WEB_LIQUIDATION_NORM_DAYS,
  type WebLiquidationCoin, type WebLiquidationsOverviewResponse,
} from '@trade-automation/contracts';
import { DB, type Db } from '../../db/db.port';
import { normPeriodStart } from './norm';
import { windowStats } from './overview.assemble';
import * as repo from './pg/overview.repo';

/**
 * IB-038 — `GET /api/web/liquidations/overview` (§12.3).
 *
 * **The venues this deployment collects liquidations from.** `missing` is this list minus the
 * venues that actually wrote rows, which is how §12.4's «Binance: нет данных» reaches the page
 * as evidence rather than as a hard-coded sentence: Binance is REST-degraded here and has no
 * `forceOrder`, so it writes nothing and appears as missing on its own.
 */
export const LIQUIDATION_VENUES = ['binance', 'bybit', 'okx'] as const;

/** §12.3. Several members polling the landing page must not multiply the query. */
export const OVERVIEW_CACHE_MS = 15_000;

@Injectable()
export class LiquidationsOverviewService {
  /**
   * Keyed by the parameters that change the answer, and holding the **promise** rather than the
   * value: two members arriving in the same 50 ms should share one query, not start two and race
   * to fill the slot.
   */
  private readonly cache = new Map<string, { at: number; value: Promise<WebLiquidationsOverviewResponse> }>();

  constructor(
    @Inject(DB) private readonly db: Db | null,
    /** Injected so the cache's expiry is spec'able without sleeping. `@Optional()` or Nest fails to resolve it. */
    @Optional() private readonly now: () => number = () => Date.now(),
  ) {}

  async overview(q: { topN: number; feedMinUsd: number; feedLimit: number }): Promise<WebLiquidationsOverviewResponse> {
    const key = `${q.topN}:${q.feedMinUsd}:${q.feedLimit}`;
    const hit = this.cache.get(key);
    const nowMs = this.now();
    if (hit && nowMs - hit.at < OVERVIEW_CACHE_MS) return hit.value;

    const value = this.compute(q, nowMs).catch((error: unknown) => {
      // a failed read must not be cached for 15 s, or one blip becomes a quarter-minute outage
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { at: nowMs, value });
    return value;
  }

  private async compute(
    q: { topN: number; feedMinUsd: number; feedLimit: number },
    nowMs: number,
  ): Promise<WebLiquidationsOverviewResponse> {
    const db = this.db;
    if (!db) throw new Error('no database');

    const widestSec = Math.max(...Object.values(WEB_LIQUIDATION_WINDOW_SECONDS));
    const capMs = nowMs - WEB_LIQUIDATION_NORM_DAYS * 86_400_000;

    // `venueFirstSeen` is bounded to the cap, so a venue older than the period reports the cap
    // and `normPeriodStart` leaves the period at its full length.
    const [firstSeen, feedRows, present, ranked] = await Promise.all([
      repo.venueFirstSeen(db, { fromMs: capMs, toMs: nowMs }),
      repo.feed(db, { fromMs: nowMs - widestSec * 1000, toMs: nowMs, minUsd: q.feedMinUsd, limit: q.feedLimit }),
      repo.venuesWithRows(db, { fromMs: nowMs - widestSec * 1000, toMs: nowMs }),
      repo.rankedSymbols(db, q.topN),
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

    const trailing = await repo.trailingSums(db, {
      nowMs,
      windowsSec: WEB_LIQUIDATION_WINDOWS.map((w) => WEB_LIQUIDATION_WINDOW_SECONDS[w]),
    });
    // one pass per window size, as §12.3 budgets
    const bucketsByWindow = new Map(await Promise.all(
      WEB_LIQUIDATION_WINDOWS.map(async (w) => {
        const windowSec = WEB_LIQUIDATION_WINDOW_SECONDS[w];
        return [w, await repo.alignedBuckets(db, { windowSec, fromMs: periodStartMs, toMs: nowMs })] as const;
      }),
    ));

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

    return {
      asOf: Math.floor(nowMs / 1000),
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

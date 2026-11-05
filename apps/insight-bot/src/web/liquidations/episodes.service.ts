import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  WEB_MARKET_PERIOD_SECONDS,
  type WebLiquidationEpisodeNorm, type WebLiquidationEpisodePrice, type WebLiquidationEpisodesQuery, type WebLiquidationEpisodesResponse,
  type WebLiquidationsLargePeriod,
} from '@trade-automation/contracts';
import { DB, type Db } from '../../db/db.port';
import { EPISODE_NORM_DAYS, SERIES_MIN_USD } from '../../insights/thresholds';
import { IDLE_SWEEP_MS, TtlCache } from '../../venues/ttl-cache';
import { episodesAnswer } from './episodes.assemble';
import { episodeSums, groupEpisodes, type EpisodeCandidate } from './episodes.group';
import { episodeNorm } from './episodes.norm';
import { pathComplete, pathWindow, priceFacts } from './episodes.price';
import { normPeriodStart } from './norm';
import { LiquidationsOverviewService } from './overview.service';
import * as repo from './pg/overview.repo';
import { episodePrints } from './pg/episodes.repo';

/** E8: per filter key and per period base — the page polls every 10 s, as `/large`. */
export const EPISODES_CACHE_MS = 10_000;
/** E8: at most 32 filter keys (only the coin is open-ended), as `/large`. */
export const EPISODES_CACHE_KEYS = 32;
/** E2: the norm is recomputed hourly. */
export const EPISODE_NORM_CACHE_MS = 60 * 60_000;
/** E8: a path is kept 1 h while `to + 4 h` is ahead, 24 h once it has passed; at most 64 paths. */
export const PATH_PENDING_CACHE_MS = 60 * 60_000;
export const PATH_FINAL_CACHE_MS = 24 * 60 * 60_000;
export const PATH_CACHE_KEYS = 64;
/** A failed or not-yet-readable path is asked for again after a minute, not on every 10 s poll. */
export const PATH_RETRY_MS = 60_000;
/**
 * The period base reads this far before the period start, so an episode that began just before it
 * is grouped whole and keeps its id; an episode belongs to the period when its LAST print is in it.
 */
export const EPISODE_LOOKBACK_MS = 60 * 60_000;
/** Read bounds: a 7d base on the box is ~2–5k prints (E8), a 30-day norm ≤ ~25k. Hitting one is logged. */
export const EPISODE_BASE_CAP = 20_000;
export const EPISODE_NORM_READ_CAP = 200_000;

/** The venue side of E8, injected: the universe's Binance perp for a coin, and the exact-limit 1m read. */
export interface EpisodePriceReader {
  binancePerp(symbolId: string): string | null;
  closedKlines1m(symbol: string, fromMs: number, limit: number): Promise<Array<{ time: number; open: number; close: number }>>;
}
export const EPISODE_PRICE_READER = Symbol('EPISODE_PRICE_READER');

interface PeriodBase {
  asOf: number;
  candidates: EpisodeCandidate[];
}

/**
 * IB-133 — `GET /api/web/liquidations/episodes` (liquidation-episodes design E1–E8). Episodes and the
 * norm come from our tape (venue weight 0); only the shown episodes' price paths touch Binance, once
 * each (weight 2), then from cache.
 */
@Injectable()
export class LiquidationEpisodesService {
  private readonly logger = new Logger(LiquidationEpisodesService.name);
  private readonly answers: TtlCache;
  private readonly bases: TtlCache;
  private readonly norms: TtlCache;
  private readonly paths: TtlCache;

  constructor(
    @Inject(DB) private readonly db: Db | null,
    private readonly overview: LiquidationsOverviewService,
    @Inject(EPISODE_PRICE_READER) private readonly prices: EpisodePriceReader,
    @Optional() private readonly now: () => number = () => Date.now(),
  ) {
    const clock = () => this.now();
    this.answers = new TtlCache({ now: clock, maxEntries: EPISODES_CACHE_KEYS, name: 'liquidation-episodes', idleSweepMs: IDLE_SWEEP_MS });
    this.bases = new TtlCache({ now: clock, maxEntries: 2, name: 'liquidation-episodes-base', idleSweepMs: IDLE_SWEEP_MS });
    this.norms = new TtlCache({ now: clock, maxEntries: 1, name: 'liquidation-episodes-norm', idleSweepMs: IDLE_SWEEP_MS });
    this.paths = new TtlCache({ now: clock, maxEntries: PATH_CACHE_KEYS, name: 'liquidation-episodes-paths', idleSweepMs: IDLE_SWEEP_MS });
  }

  episodes(q: WebLiquidationEpisodesQuery): Promise<WebLiquidationEpisodesResponse> {
    const key = `${q.period}:${q.symbol}:${q.minUsd}:${q.side}:${q.venue}`;
    return this.answers.getOrLoad(key, EPISODES_CACHE_MS, async () => {
      const [base, norm] = await Promise.all([this.base(q.period), this.norm()]);
      const { response, shown } = episodesAnswer({ asOf: base.asOf, candidates: base.candidates, norm, query: q });
      const prices = await Promise.all(shown.map((c) => this.price(c)));
      response.episodes.forEach((e, i) => { e.price = prices[i] ?? null; });
      return response;
    });
  }

  /** E5: the period's candidates, grouped once over the whole market; every filter is applied after. */
  private base(period: WebLiquidationsLargePeriod): Promise<PeriodBase> {
    return this.bases.getOrLoad(period, EPISODES_CACHE_MS, async () => {
      const db = this.requireDb();
      const nowMs = this.now();
      const periodStartMs = nowMs - WEB_MARKET_PERIOD_SECONDS[period] * 1000;
      const { keys, aliases } = await this.overview.cryptoScope(nowMs);
      const prints = await episodePrints(db, {
        fromMs: periodStartMs - EPISODE_LOOKBACK_MS, toMs: nowMs, minUsd: SERIES_MIN_USD, limit: EPISODE_BASE_CAP, keys, aliases,
      });
      if (prints.length >= EPISODE_BASE_CAP) {
        this.logger.warn(`liquidations/episodes ${period}: the base reached ${EPISODE_BASE_CAP} prints; the oldest episodes are cut`);
      }
      return {
        asOf: Math.floor(nowMs / 1000),
        candidates: groupEpisodes(prints).filter((c) => c.toMs >= periodStartMs),
      };
    });
  }

  /** E2: one hourly read of the trailing `held` window, grouped by the same function. */
  private norm(): Promise<WebLiquidationEpisodeNorm> {
    return this.norms.getOrLoad('norm', EPISODE_NORM_CACHE_MS, async () => {
      const db = this.requireDb();
      const nowMs = this.now();
      const { keys, aliases } = await this.overview.cryptoScope(nowMs);
      const capMs = nowMs - EPISODE_NORM_DAYS * 86_400_000;
      // IB-038's rule: a venue joining later starts the window when it started (norm.ts)
      const firstSeen = await repo.venueFirstSeen(db, { fromMs: capMs, toMs: nowMs, keys, aliases });
      const perVenue = new Map<string, number>();
      for (const r of firstSeen) perVenue.set(r.venue, Math.min(perVenue.get(r.venue) ?? Infinity, r.firstSeenMs));
      const startMs = normPeriodStart([...perVenue.values()], nowMs, EPISODE_NORM_DAYS);
      const prints = await episodePrints(db, { fromMs: startMs, toMs: nowMs, minUsd: SERIES_MIN_USD, limit: EPISODE_NORM_READ_CAP, keys, aliases });
      if (prints.length >= EPISODE_NORM_READ_CAP) {
        this.logger.warn(`liquidations/episodes norm: the read reached ${EPISODE_NORM_READ_CAP} prints; the oldest are not in the norm`);
      }
      return episodeNorm({ candidateSums: episodeSums(prints), heldMs: nowMs - startMs });
    });
  }

  /**
   * E8: the largest coin's 1m path, soft. Keyed by the episode's id AND its end, so an episode still
   * growing is read again when it grows, and a finished one is one read for its lifetime in the cache.
   */
  private async price(c: EpisodeCandidate): Promise<WebLiquidationEpisodePrice | null> {
    const coin = c.coins[0]?.symbol;
    const symbol = coin === undefined ? null : this.prices.binancePerp(coin);
    if (symbol === null) return null;
    const w = pathWindow(c.fromMs, c.toMs);
    const key = `${symbol}:${c.id}:${c.toMs}`;
    const ttl = pathComplete(w, this.now()) ? PATH_FINAL_CACHE_MS : PATH_PENDING_CACHE_MS;
    try {
      const value = await this.paths.getOrLoad(
        key, ttl, async () => priceFacts(symbol, await this.prices.closedKlines1m(symbol, w.fromMs, w.limit), w), (v) => v !== null,
      );
      if (value === null) this.paths.set(key, null, PATH_RETRY_MS);
      return value;
    } catch (error) {
      this.logger.warn(`liquidations/episodes: price path ${symbol} for ${c.id} failed: ${(error as Error).message}`);
      this.paths.set(key, null, PATH_RETRY_MS);
      return null;
    }
  }

  private requireDb(): Db {
    if (!this.db) throw new Error('no database');
    return this.db;
  }
}

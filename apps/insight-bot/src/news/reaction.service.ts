import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import { othersInWindow, pendingReactions, saveReaction, type PriceScope } from '../db/pg/reaction-reads';
import { BinanceWeightTracker } from '../venues/binance/binance-weight.tracker';
import { PerpRest } from '../venues/binance/perp.rest';
import { isInvalidSymbol } from '../venues/binance/rest.base';
import { WEIGHT_CEILING_1M } from '../web/market/universe-summary.service';
import { computeReaction, HORIZONS, reactionWindow, type Horizon, type Reaction } from './reaction';
import {
  barsFromKlines, closeAtOrBefore, closedBars, klinesRequest, klinesWeight, MAX_VENUE_CALLS_PER_PASS,
  windowCoverage, type ReactionBar,
} from './reaction-prices';
import { SpendsWeightAs } from '../venues/binance/weight-caller';

/** Every five minutes: the shortest horizon is 15m, so nothing waits long for its window to close. */
export const REACTION_TICK_MS = 5 * 60_000;

/** What one pass spent and left behind. Logged, and returned so a spec or a live check can read it. */
export interface ReactionPass {
  /** `/fapi/v1/klines` requests made. Never more than `MAX_VENUE_CALLS_PER_PASS`. */
  venueCalls: number;
  /** Their documented weight (`klinesWeight`), recorded on the shared tracker as each call is made. */
  venueWeight: number;
  measured: number;
  refused: number;
  /** Left pending with NO row written, for the next pass: over the call cap, over the weight ceiling, or a venue error. */
  deferred: { callCap: number; weightCeiling: number; venueError: number };
  /** The first venue error's message, for the one summary line a pass logs (not one line per call). */
  firstVenueError: string | null;
  /** Stored as the permanent refusal `symbol_unavailable`: the venue answered -1121 "Invalid symbol". */
  symbolUnavailable: number;
}

/**
 * IB-027 — computes `news_reactions` for tagged articles (§10).
 *
 * A shell, like the poll: the arithmetic and every refusal rule are in `reaction.ts`, the price
 * rules in `reaction-prices.ts`, the SQL in `db/pg/reaction-reads.ts`. What is decided here is
 * **where the price comes from**, and when not to ask.
 *
 * **IB-097 (storage ruling S8): the price comes from Binance 1m klines, fetched on demand.**
 * Nothing writes the 1m candle tape since WD-010. One request per measurement, made only once every
 * refusal that needs no price has been ruled out (stale story, no spelling, open window), so an
 * article that refuses anyway costs nothing. Weight and call shape are in `reaction-prices.ts`.
 *
 * **One venue answer IS a refusal: -1121 "Invalid symbol"** (`isInvalidSymbol`: HTTP 400 AND that
 * code, never any 400). It is stored as `symbol_unavailable`, so a delisted spelling stops spending
 * the call cap; otherwise enough of them, pending oldest-first, would starve every valid reaction.
 *
 * **Any other failure to ask is not a refusal.** A venue error, the per-pass cap or the shared weight ceiling
 * (`WEIGHT_CEILING_1M`, the same one the on-demand reads respect) writes NO row. A stored refusal is
 * permanent (`pendingReactions` re-offers only `window_not_closed`), so saving one here would turn
 * a network blip into a reaction that is never measured. With no row the article stays pending and
 * the next pass asks again.
 *
 * **One venue and market per reaction, stated in the row.** The measurement is taken on the
 * symbol's Binance perp series; the row records `venue`, `market` and the spelling queried so
 * nothing downstream has to assume it. A move measured on one venue and presented as "the asset's
 * reaction" is the «все биржи» error, and the cure is saying which venue rather than averaging.
 */
@Injectable()
export class ReactionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NewsReactions');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Db | null,
    private readonly perp: PerpRest,
    private readonly weight: BinanceWeightTracker,
    @Optional() private readonly config?: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.db) {
      this.logger.warn('no database — news reactions disabled');
      return;
    }
    void this.tick();
    this.timer = setInterval(() => void this.tick(), REACTION_TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over everything pending. Public so a spec can drive it without timers. */
  @SpendsWeightAs('news_reaction')
  async tick(now = Date.now()): Promise<ReactionPass | null> {
    const db = this.db;
    if (!db || this.running) return null;
    this.running = true;
    const pass: ReactionPass = {
      venueCalls: 0, venueWeight: 0, measured: 0, refused: 0,
      deferred: { callCap: 0, weightCeiling: 0, venueError: 0 },
      firstVenueError: null,
      symbolUnavailable: 0,
    };
    try {
      for (const horizon of HORIZONS) {
        await this.computeHorizon(db, horizon, now, pass);
      }
      const { callCap, weightCeiling, venueError } = pass.deferred;
      if (venueError > 0) {
        // one line per pass, however many calls failed: during a venue outage that is up to 100 calls
        this.logger.warn(`${venueError} klines calls failed this pass, no rows written, retried next pass — first: ${pass.firstVenueError}`);
      }
      if (pass.venueCalls + pass.measured + pass.refused + callCap + weightCeiling + venueError > 0) {
        this.logger.log(
          `pass: ${pass.measured} measured, ${pass.refused} refused; ${pass.venueCalls} klines calls, ` +
            `weight ${pass.venueWeight}; left for the next pass: ${callCap} over the call cap, ` +
            `${weightCeiling} over the weight ceiling, ${venueError} venue errors`,
        );
      }
      return pass;
    } catch (error) {
      this.logger.error(`reaction pass failed — ${(error as Error).message}`);
      return pass;
    } finally {
      this.running = false;
    }
  }

  private async computeHorizon(db: Db, horizon: Horizon, now: number, pass: ReactionPass): Promise<void> {
    const pending = await pendingReactions(db, horizon);

    for (const item of pending) {
      const scope = this.scopeFor(item.symbol);
      // the anchor is our first-seen instant by default; `computeReaction` owns that choice, and
      // the window must agree with it, so it is derived from the same place
      const window = reactionWindow(item.firstSeenAt, horizon);
      const base = {
        horizon,
        publishedAt: item.publishedAt,
        firstSeenAt: item.firstSeenAt,
        symbolSpelling: scope?.spelling ?? null,
        windowClosed: now >= window.to.getTime(),
        othersInWindow: await othersInWindow(db, item.symbol, item.newsId, window.from, window.to),
      };

      // First without prices. Every refusal that needs none (stale, no spelling, open window) comes
      // before `window_not_covered` in computeReaction's order, so reaching that one means "only the
      // price is missing", and only then is the venue asked.
      let reaction: Reaction = computeReaction({ ...base, windowCovered: false, priceAtAnchor: null, priceAtHorizon: null });
      if (reaction.refused === 'window_not_covered' && scope !== null) {
        const bars = await this.fetchBars(scope, window, now, pass);
        if (bars === null) continue; // no row: still pending, asked again next pass
        reaction = bars === 'symbol_unavailable'
          ? { ...reaction, returnPct: null, refused: 'symbol_unavailable' }
          : computeReaction({
            ...base,
            windowCovered: windowCoverage(bars, window.from, window.to).covered,
            priceAtAnchor: closeAtOrBefore(bars, window.from),
            priceAtHorizon: closeAtOrBefore(bars, window.to),
          });
      }

      await saveReaction(db, item.newsId, item.symbol, scope ?? this.unknownScope(item.symbol), reaction);
      if (reaction.returnPct === null) pass.refused += 1;
      else pass.measured += 1;
    }
  }

  /**
   * The window's closed 1m bars from the venue; `'symbol_unavailable'` when the venue says it does
   * not know the symbol (-1121, a permanent answer); null when the pass must not or could not ask.
   */
  private async fetchBars(
    scope: PriceScope, window: { from: Date; to: Date }, now: number, pass: ReactionPass,
  ): Promise<ReactionBar[] | 'symbol_unavailable' | null> {
    if (pass.venueCalls >= MAX_VENUE_CALLS_PER_PASS) {
      pass.deferred.callCap += 1;
      return null;
    }
    if (this.weight.used1m() > WEIGHT_CEILING_1M) {
      pass.deferred.weightCeiling += 1;
      return null;
    }
    const request = klinesRequest(window);
    const weight = klinesWeight(request.limit);
    pass.venueCalls += 1;
    pass.venueWeight += weight;
    this.weight.recordCall(weight);
    try {
      const rows = await this.perp.klinesRange(scope.spelling, request.startTime, request.endTime, request.limit);
      return closedBars(barsFromKlines(rows), now);
    } catch (error) {
      if (isInvalidSymbol(error)) {
        pass.symbolUnavailable += 1;
        return 'symbol_unavailable';
      }
      // any other 4xx/5xx or network error: no row, retried next pass; summarised once per pass
      pass.deferred.venueError += 1;
      pass.firstVenueError ??= `${scope.spelling}: ${(error as Error).message}`;
      return null;
    }
  }

  /**
   * Where this symbol's price is read from: its Binance perp spelling.
   *
   * Resolved from the universe rather than by assuming the canonical id is the venue's spelling —
   * they coincide for Binance perps today and would not for another venue, and relying on the
   * coincidence is how IB-BUG-011 happened twice.
   */
  private scopeFor(symbolId: string): PriceScope | null {
    const entry = this.config?.symbols.find((s) => s.id === symbolId);
    if (!entry?.binance_perp) return null;
    return { spelling: entry.binance_perp, venue: 'binance', market: 'perp' };
  }

  /** The scope recorded on a refusal when no spelling exists — the row still says what was tried. */
  private unknownScope(symbolId: string): PriceScope {
    return { spelling: symbolId, venue: 'binance', market: 'perp' };
  }
}

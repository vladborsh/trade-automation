import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import {
  closeAtOrBefore, othersInWindow, pendingReactions, saveReaction, windowCoverage, type PriceScope,
} from '../db/pg/reaction-reads';
import { computeReaction, HORIZONS, reactionWindow, type Horizon } from './reaction';
import { neverReject } from '../ops/never-reject';

/** Every five minutes: the shortest horizon is 15m, so nothing waits long for its window to close. */
export const REACTION_TICK_MS = 5 * 60_000;

/**
 * IB-027 — computes `news_reactions` for tagged articles (§10).
 *
 * A shell, like the poll: the arithmetic and every refusal rule are in `reaction.ts`, the SQL in
 * `db/pg/reaction-reads.ts`. What is decided here is only **where the price comes from**.
 *
 * **One venue and market per reaction, stated in the row.** The measurement is taken on the
 * symbol's Binance perp series, because that is the venue whose candles we hold for every universe
 * symbol; the row records `venue`, `market` and the spelling queried so nothing downstream has to
 * assume it. A move measured on one venue and presented as "the asset's reaction" is the «все
 * биржи» error, and the cure is saying which venue rather than averaging.
 */
@Injectable()
export class ReactionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NewsReactions');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Db | null,
    @Optional() private readonly config?: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.db) {
      this.logger.warn('no database — news reactions disabled');
      return;
    }
    neverReject(this.logger, 'reaction tick', () => this.tick());
    this.timer = setInterval(() => neverReject(this.logger, 'reaction tick', () => this.tick()), REACTION_TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over everything pending. Public so a spec can drive it without timers. */
  async tick(now = Date.now()): Promise<void> {
    const db = this.db;
    if (!db || this.running) return;
    this.running = true;
    try {
      for (const horizon of HORIZONS) {
        await this.computeHorizon(db, horizon, now);
      }
    } catch (error) {
      this.logger.error(`reaction pass failed — ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async computeHorizon(db: Db, horizon: Horizon, now: number): Promise<void> {
    const pending = await pendingReactions(db, horizon);
    let measured = 0;
    let refused = 0;

    for (const item of pending) {
      const scope = this.scopeFor(item.symbol);
      // the anchor is our first-seen instant by default; `computeReaction` owns that choice, and
      // the window must agree with it, so it is derived from the same place
      const anchorAt = item.firstSeenAt;
      const window = reactionWindow(anchorAt, horizon);
      const windowClosed = now >= window.to.getTime();

      const reaction = computeReaction({
        horizon,
        publishedAt: item.publishedAt,
        firstSeenAt: item.firstSeenAt,
        symbolSpelling: scope?.spelling ?? null,
        windowClosed,
        // only asked once the window has closed: coverage of a window still being collected is not
        // a meaningful question, and asking would make an open window look like a holed one
        windowCovered: scope !== null && windowClosed
          ? (await windowCoverage(db, scope, window.from, window.to)).covered
          : false,
        priceAtAnchor: scope !== null && windowClosed ? await closeAtOrBefore(db, scope, window.from) : null,
        priceAtHorizon: scope !== null && windowClosed ? await closeAtOrBefore(db, scope, window.to) : null,
        othersInWindow: await othersInWindow(db, item.symbol, item.newsId, window.from, window.to),
      });

      await saveReaction(db, item.newsId, item.symbol, scope ?? this.unknownScope(item.symbol), reaction);
      if (reaction.returnPct === null) refused += 1;
      else measured += 1;
    }

    if (pending.length > 0) {
      this.logger.log(`${horizon}: ${measured} measured, ${refused} refused of ${pending.length} pending`);
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

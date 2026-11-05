import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  WEB_LIQUIDATIONS_LARGE_LIMIT, WEB_MARKET_PERIOD_SECONDS,
  type WebLiquidationsLargePeriod, type WebLiquidationsLargeQuery, type WebLiquidationsLargeResponse,
} from '@trade-automation/contracts';
import { DB, type Db } from '../../db/db.port';
import { SERIES_MIN_USD } from '../../insights/thresholds';
import { IDLE_SWEEP_MS, TtlCache } from '../../venues/ttl-cache';
import { LARGE_PAGE_BASE_CAP, largeAnswer, largeBase, type LargeBase } from './large.assemble';
import { LiquidationsOverviewService } from './overview.service';
import * as repo from './pg/overview.repo';

/** §4: 10 s per filter key — the page polls every 10 s (the Market liquidation cadence). */
export const LARGE_CACHE_MS = 10_000;
/** §4: at most 32 filter keys; only the coin is open-ended, so this is what a crawler meets. */
export const LARGE_CACHE_KEYS = 32;

/**
 * IB-120 — `GET /api/web/liquidations/large` (market-round2 design §4). Our tape only: venue weight 0.
 *
 * Two caches, both bounded by entries:
 * - `liquidations-large-base`: one per period (2), the period's base — ONE query per period per 10 s
 *   whatever the members click;
 * - `liquidations-large`: one per filter key (≤ 32), each ≤ 1 000 rows that are the SAME objects as
 *   the base's, so an answer adds an array of references, not a copy.
 */
@Injectable()
export class LiquidationsLargeService {
  private readonly logger = new Logger(LiquidationsLargeService.name);
  private readonly answers: TtlCache;
  private readonly bases: TtlCache;

  constructor(
    @Inject(DB) private readonly db: Db | null,
    private readonly overview: LiquidationsOverviewService,
    @Optional() private readonly now: () => number = () => Date.now(),
  ) {
    const clock = () => this.now();
    this.answers = new TtlCache({ now: clock, maxEntries: LARGE_CACHE_KEYS, name: 'liquidations-large', idleSweepMs: IDLE_SWEEP_MS });
    this.bases = new TtlCache({ now: clock, maxEntries: 2, name: 'liquidations-large-base', idleSweepMs: IDLE_SWEEP_MS });
  }

  large(q: WebLiquidationsLargeQuery): Promise<WebLiquidationsLargeResponse> {
    const key = `${q.period}:${q.symbol}:${q.minUsd}:${q.side}:${q.venue}`;
    return this.answers.getOrLoad(key, LARGE_CACHE_MS, async () => largeAnswer(await this.base(q.period), q, WEB_LIQUIDATIONS_LARGE_LIMIT));
  }

  private base(period: WebLiquidationsLargePeriod): Promise<LargeBase> {
    return this.bases.getOrLoad(period, LARGE_CACHE_MS, async () => {
      const db = this.db;
      if (!db) throw new Error('no database');
      const nowMs = this.now();
      const periodSec = WEB_MARKET_PERIOD_SECONDS[period];
      // D6: crypto only, and another quote of a universe coin is that coin — the Market block's scope
      const { keys, aliases } = await this.overview.cryptoScope(nowMs);
      const events = await repo.feed(db, {
        fromMs: nowMs - periodSec * 1000, toMs: nowMs, minUsd: SERIES_MIN_USD, limit: LARGE_PAGE_BASE_CAP, keys, order: 'newest', aliases,
      });
      const base = largeBase(events, { nowMs, periodSec, cap: LARGE_PAGE_BASE_CAP });
      if (base.capped) {
        this.logger.warn(`liquidations/large ${period}: the base reached ${LARGE_PAGE_BASE_CAP} events; total and the oldest series describe the newest ${LARGE_PAGE_BASE_CAP} only`);
      }
      return base;
    });
  }
}

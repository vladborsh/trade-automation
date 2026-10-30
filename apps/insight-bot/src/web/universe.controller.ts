import { Controller, Get, HttpException, Inject, Optional, Query } from '@nestjs/common';
import type { WebUniverseSummaryResponse, WebUniverseTopResponse } from '@trade-automation/contracts';
import { DB, type Db } from '../db/db.port';
import { UniverseSummaryService, VenueUnavailableError } from './market/universe-summary.service';
import * as repo from './series/pg/series.repo';

/**
 * IB-031 — the instrument picker's list (architecture/insight-bot-web-dashboard.md §4).
 *
 * Authenticated by `WebModule`'s module-wide guard, like every other controller here.
 */
/**
 * The most symbols one summary reads: the universe (30 crypto + 10 hand-added TradFi since IB-070)
 * with room for the next hand additions. 60 openInterestHist calls per cached minute is 2.5 % of
 * the 2,400/min budget.
 */
export const SUMMARY_MAX = 60;

@Controller('api/web/universe')
export class UniverseController {
  constructor(
    @Inject(DB) private readonly db: Db | null,
    @Optional() private readonly summaryService?: UniverseSummaryService,
  ) {}

  @Get('top')
  async top(@Query('n') n = '20'): Promise<WebUniverseTopResponse> {
    if (!this.db) throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
    // capped: the picker is a list a person reads, and `n=100000` is not a real request
    const count = Math.min(Math.max(1, Number(n) || 20), 100);
    const rows = await repo.topSymbols(this.db, count);
    return {
      symbols: rows.map((r) => ({
        id: r.id, base: r.base, quote: r.quote, volumeRank: r.volumeRank, inSignalSet: r.inSignalSet,
        venues: {
          binancePerp: r.binancePerp, binanceSpot: r.binanceSpot,
          bybitLinear: r.bybitLinear, okxSwap: r.okxSwap,
        },
      })),
    };
  }

  /**
   * The symbol dropdown: the same top list, with live price change, predicted funding and
   * open-interest change per coin (`market/universe-summary.service.ts` has the weight budget).
   */
  @Get('summary')
  async summary(@Query('n') n = '20'): Promise<WebUniverseSummaryResponse> {
    if (!this.db) throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
    if (!this.summaryService) throw new HttpException({ code: 'VENUE_UNAVAILABLE', message: 'summary not configured' }, 503);
    // SUMMARY_MAX, not 100: each symbol costs a venue call (one openInterestHist, weight 1, per
    // cached minute). IB-070 raised it from 20 so the picker's whole universe (40) has figures.
    const count = Math.min(Math.max(1, Number(n) || 20), SUMMARY_MAX);
    const rows = await repo.topSymbols(this.db, count);
    try {
      return await this.summaryService.summary(rows.map((r) => ({ id: r.id, base: r.base, volumeRank: r.volumeRank })));
    } catch (error) {
      if (error instanceof VenueUnavailableError) {
        throw new HttpException({ code: 'VENUE_UNAVAILABLE', message: error.message }, 503);
      }
      throw error;
    }
  }
}

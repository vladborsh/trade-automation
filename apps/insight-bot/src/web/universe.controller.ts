import { Controller, Get, HttpException, Inject, Query } from '@nestjs/common';
import type { WebUniverseTopResponse } from '@trade-automation/contracts';
import { DB, type Db } from '../db/db.port';
import * as repo from './series/pg/series.repo';

/**
 * IB-031 — the instrument picker's list (architecture/insight-bot-web-dashboard.md §4).
 *
 * Authenticated by `WebModule`'s module-wide guard, like every other controller here.
 */
@Controller('api/web/universe')
export class UniverseController {
  constructor(@Inject(DB) private readonly db: Db | null) {}

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
}

import { Controller, Get, HttpException, Inject, Optional, Query } from '@nestjs/common';
import type { WebLiqProfileResponse } from '@trade-automation/contracts';
import { DB, type Db } from '../../db/db.port';
import { LiqProfileService } from './liq-profile.service';
import { checkRange } from './range';

/**
 * IB-153 — `GET /api/web/series/liquidations/profile?symbol&from&to&lo&hi`: the instrument page's
 * liquidation profile by price. `from`/`to` are epoch ms, `to` exclusive, and are refused past the 1m
 * rule's 90 days like every tape read; `lo`/`hi` are the price span the chart shows, from which the
 * contract's `profileGrid` picks the step and the cover. Weight 0: our tape only.
 *
 * Behind `WebModule`'s module-wide guard, like the other series routes.
 */
@Controller('api/web/series')
export class LiqProfileController {
  constructor(
    @Inject(DB) private readonly db: Db | null,
    @Optional() private readonly service?: LiqProfileService,
  ) {}

  @Get('liquidations/profile')
  async profile(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('lo') lo: string,
    @Query('hi') hi: string,
  ): Promise<WebLiqProfileResponse> {
    if (!/^[A-Z0-9]{2,30}$/.test(symbol ?? '')) throw new HttpException({ code: 'BAD_REQUEST', message: 'unknown symbol' }, 400);
    const low = Number(lo);
    const high = Number(hi);
    // a non-positive price is no span a chart shows; refusing it keeps the grid's log10 on real numbers
    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0) {
      throw new HttpException({ code: 'BAD_REQUEST', message: 'lo and hi must be positive prices' }, 400);
    }
    const range = checkRange(Number(from), Number(to), '1m');
    if (!range.ok) {
      const body = range.code === 'RANGE_TOO_WIDE'
        ? { code: range.code, message: range.message, maxDays: range.maxDays }
        : { code: range.code, message: range.message };
      throw new HttpException(body, 400);
    }
    if (!this.db || !this.service) throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
    return this.service.profile(symbol, range.fromMs, range.toMs, low, high);
  }
}

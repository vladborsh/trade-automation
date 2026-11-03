import { Controller, Get, HttpException, Query } from '@nestjs/common';
import { WebMarketPeriodSchema, type WebLiquidationsOverviewResponse } from '@trade-automation/contracts';
import { LiquidationsOverviewService } from './overview.service';

/**
 * IB-038 — the landing page's liquidation surfaces (§12.3).
 *
 * Authenticated by `WebModule`'s module-wide guard, like every other controller here: no
 * decorator, so there is exactly one place that decides who may read the dashboard.
 *
 * One endpoint feeds the card, the table and the feed because they answer one question. Three
 * endpoints would let them disagree about the same minute, and a card saying «спокойно» above a
 * table of red cells is worse than either on its own.
 */
@Controller('api/web/liquidations')
export class LiquidationsController {
  constructor(private readonly service: LiquidationsOverviewService) {}

  @Get('overview')
  async overview(
    @Query('symbols') symbols = 'top20',
    @Query('feed_min_usd') feedMinUsd = '100000',
    @Query('feed_limit') feedLimit = '30',
    @Query('period') period = '24h',
  ): Promise<WebLiquidationsOverviewResponse> {
    // IB-084 (D14): the page-wide period; an unknown one is a 400, not a silent 24h
    const parsedPeriod = WebMarketPeriodSchema.safeParse(period);
    if (!parsedPeriod.success) {
      throw new HttpException({ code: 'BAD_REQUEST', message: 'period must be one of 1h, 4h, 24h, 7d' }, 400);
    }
    // `symbols` is an enum of one today. Validated rather than ignored, so a caller asking for
    // something we do not serve is told, instead of quietly receiving the top 20 and believing
    // it asked for more.
    if (symbols !== 'top20') {
      throw new HttpException({ code: 'BAD_REQUEST', message: 'symbols must be top20' }, 400);
    }
    // Clamped, not rejected, as everywhere else in this API: these shape a view, and a silly
    // number is a slider dragged too far, not a protocol error.
    const minUsd = Math.min(Math.max(0, Number(feedMinUsd) || 0), 100_000_000);
    const limit = Math.min(Math.max(1, Number(feedLimit) || 30), 200);

    try {
      return await this.service.overview({ topN: 20, feedMinUsd: minUsd, feedLimit: limit, period: parsedPeriod.data });
    } catch (error) {
      if ((error as Error).message === 'no database') {
        throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
      }
      throw error;
    }
  }
}

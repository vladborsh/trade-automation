import { Controller, Get, HttpException, Inject, Query } from '@nestjs/common';
import type { WebChartCustomLevelsResponse } from '@trade-automation/contracts';
import { CustomLevels } from '../../alerts/levels/custom-levels';
import { AdminOnly } from '../auth/web-auth.guard';
import { CUSTOM_LEVELS } from '../admin/custom-levels.controller';

/**
 * IB-128 (design §4 P9, §5) — `GET /api/web/series/custom-levels?symbol=`: one coin's active custom levels, for the
 * instrument chart's lines. **Admins only**: the levels are the owner's own, not a member feature (a member's chart
 * never asks; a member who does gets 403). One indexed DB read, no venue call, no cache (a level added on the admin
 * page shows on the next chart load).
 */
@AdminOnly()
@Controller('api/web/series')
export class CustomLevelsSeriesController {
  constructor(@Inject(CUSTOM_LEVELS) private readonly levels: CustomLevels | null) {}

  @Get('custom-levels')
  customLevels(@Query('symbol') symbol: string): Promise<WebChartCustomLevelsResponse> {
    if (!/^[A-Z0-9]{2,30}$/.test(symbol ?? '')) throw new HttpException({ code: 'BAD_REQUEST', message: 'unknown symbol' }, 400);
    if (!this.levels) throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
    return this.levels.chart(symbol);
  }
}

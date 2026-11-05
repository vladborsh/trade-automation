import { Controller, Get, HttpException, Query } from '@nestjs/common';
import { WebLiquidationEpisodesQuerySchema, type WebLiquidationEpisodesResponse } from '@trade-automation/contracts';
import { LiquidationEpisodesService } from './episodes.service';

/**
 * IB-133 — `GET /api/web/liquidations/episodes?period&symbol&minUsd&side&venue`, the /liquidations
 * page as «episodes» (liquidation-episodes design E7). Behind `WebModule`'s module-wide guard like
 * every web controller. The query is parsed exactly as `/large`'s: an unknown value is a 400.
 */
@Controller('api/web/liquidations')
export class LiquidationEpisodesController {
  constructor(private readonly service: LiquidationEpisodesService) {}

  @Get('episodes')
  async episodes(@Query() raw: Record<string, unknown>): Promise<WebLiquidationEpisodesResponse> {
    const parsed = WebLiquidationEpisodesQuerySchema.safeParse(raw);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new HttpException({ code: 'BAD_REQUEST', message }, 400);
    }
    try {
      return await this.service.episodes(parsed.data);
    } catch (error) {
      if ((error as Error).message === 'no database') {
        throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
      }
      throw error;
    }
  }
}

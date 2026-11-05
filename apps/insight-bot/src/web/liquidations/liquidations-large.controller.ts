import { Controller, Get, HttpException, Query } from '@nestjs/common';
import { WebLiquidationsLargeQuerySchema, type WebLiquidationsLargeResponse } from '@trade-automation/contracts';
import { LiquidationsLargeService } from './large.service';

/**
 * IB-120 — `GET /api/web/liquidations/large?period&symbol&minUsd&side&venue`, the /liquidations
 * page. Behind `WebModule`'s module-wide guard like every web controller: admin and member, as Market.
 *
 * Unlike the overview's thresholds, every filter here is a closed set and an unknown value is a 400:
 * these are chips, not sliders, and a URL edited by hand should be told, not shown the default.
 */
@Controller('api/web/liquidations')
export class LiquidationsLargeController {
  constructor(private readonly service: LiquidationsLargeService) {}

  @Get('large')
  async large(@Query() raw: Record<string, unknown>): Promise<WebLiquidationsLargeResponse> {
    const parsed = WebLiquidationsLargeQuerySchema.safeParse(raw);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new HttpException({ code: 'BAD_REQUEST', message }, 400);
    }
    try {
      return await this.service.large(parsed.data);
    } catch (error) {
      if ((error as Error).message === 'no database') {
        throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
      }
      throw error;
    }
  }
}

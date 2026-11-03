import { Controller, Get, HttpException, Optional, Query } from '@nestjs/common';
import { WebMarketPeriodSchema, type WebCapsResponse } from '@trade-automation/contracts';
import { CapsService } from './caps.service';

/**
 * The market page's block endpoints (market-page design D1–D17). Behind IB-029's module-wide
 * `APP_GUARD`, like every `/api/web` controller. IB-087: the caps block.
 */
@Controller('api/web/market')
export class WebMarketController {
  constructor(@Optional() private readonly capsService?: CapsService) {}

  /** `GET …/market/caps?period=1h|4h|24h|7d` (default 24h) — treemap + dominance bar (D11). */
  @Get('caps')
  async caps(@Query('period') period = '24h'): Promise<WebCapsResponse> {
    const parsed = WebMarketPeriodSchema.safeParse(period);
    if (!parsed.success) throw new HttpException({ code: 'BAD_REQUEST', message: 'period must be 1h, 4h, 24h or 7d' }, 400);
    if (!this.capsService) throw new HttpException({ code: 'VENUE_UNAVAILABLE', message: 'caps not configured' }, 503);
    return this.capsService.caps(parsed.data);
  }
}

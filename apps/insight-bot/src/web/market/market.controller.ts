import { Controller, Get, HttpException, Optional, Query } from '@nestjs/common';
import { WebMarketPeriodSchema, type WebCapsResponse, type WebKpisResponse, type WebPositioningResponse } from '@trade-automation/contracts';
import { CapsService } from './caps.service';
import { KpisService } from './positioning/kpis.service';
import { PositioningService } from './positioning/positioning.service';

/**
 * The market page's block endpoints (market-page design D1–D17). Behind IB-029's module-wide
 * `APP_GUARD`, like every `/api/web` controller. IB-087: the caps block. IB-085: positioning and KPIs.
 */
@Controller('api/web/market')
export class WebMarketController {
  constructor(
    @Optional() private readonly capsService?: CapsService,
    @Optional() private readonly positioningService?: PositioningService,
    @Optional() private readonly kpisService?: KpisService,
  ) {}

  /** `GET …/market/caps?period=1h|4h|24h|7d` (default 24h) — treemap + dominance bar (D11). */
  @Get('caps')
  async caps(@Query('period') period = '24h'): Promise<WebCapsResponse> {
    const parsed = WebMarketPeriodSchema.safeParse(period);
    if (!parsed.success) throw new HttpException({ code: 'BAD_REQUEST', message: 'period must be 1h, 4h, 24h or 7d' }, 400);
    if (!this.capsService) throw new HttpException({ code: 'VENUE_UNAVAILABLE', message: 'caps not configured' }, 503);
    return this.capsService.caps(parsed.data);
  }

  /** `GET …/market/positioning?period=1h|4h|24h|7d` (default 24h) — the per-coin table (D9). */
  @Get('positioning')
  async positioning(@Query('period') period = '24h'): Promise<WebPositioningResponse> {
    const parsed = WebMarketPeriodSchema.safeParse(period);
    if (!parsed.success) throw new HttpException({ code: 'BAD_REQUEST', message: 'period must be 1h, 4h, 24h or 7d' }, 400);
    if (!this.positioningService) throw new HttpException({ code: 'VENUE_UNAVAILABLE', message: 'positioning not configured' }, 503);
    return this.positioningService.positioning(parsed.data);
  }

  /** `GET …/market/kpis` — the six tiles (D10). */
  @Get('kpis')
  async kpis(): Promise<WebKpisResponse> {
    if (!this.kpisService) throw new HttpException({ code: 'VENUE_UNAVAILABLE', message: 'kpis not configured' }, 503);
    return this.kpisService.kpis();
  }
}

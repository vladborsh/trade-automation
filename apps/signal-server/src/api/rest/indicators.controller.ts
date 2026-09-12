import { Controller, Get, Query, UsePipes } from '@nestjs/common';
import { IndicatorsQuerySchema, IndicatorsResponse } from '@trade-automation/contracts';
import { IndicatorCache } from '../../strategy-engine/indicator-cache.service';
import { ZodValidationPipe } from '../zod-validation.pipe';

/** architecture/live-signal-server.md §11.4 — GET /api/indicators. */
@Controller('api/indicators')
export class IndicatorsController {
  constructor(private readonly cache: IndicatorCache) {}

  @Get()
  @UsePipes(new ZodValidationPipe(IndicatorsQuerySchema))
  get(@Query() query: ReturnType<typeof IndicatorsQuerySchema.parse>): IndicatorsResponse {
    return this.cache.query(query.instrument, query.from, query.to, query.strategyId);
  }
}

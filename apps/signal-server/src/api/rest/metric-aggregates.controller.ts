import { Controller, Get, NotFoundException, Query, UsePipes } from '@nestjs/common';
import {
  AggregatePointsQuery,
  AggregatePointsQuerySchema,
  AggregatePointsResponse,
  MetricAggregatesResponse,
} from '@trade-automation/contracts';
import { AggregateMetricsService } from '../../market-data/metrics/aggregate-metrics.service';
import { ZodValidationPipe } from '../zod-validation.pipe';

/**
 * architecture/aggregate-oi.md §5 — the cross-venue aggregate, composed on read from each leg's
 * MetricCache / MetricStore rows (AggregateMetricsService → `aggregateObservations`).
 */
@Controller('api/metric-aggregates')
export class MetricAggregatesController {
  constructor(private readonly aggregates: AggregateMetricsService) {}

  @Get()
  list(): MetricAggregatesResponse {
    return this.aggregates.definitions();
  }

  @Get('points')
  @UsePipes(new ZodValidationPipe(AggregatePointsQuerySchema))
  async points(@Query() query: AggregatePointsQuery): Promise<AggregatePointsResponse> {
    const aggregate = this.aggregates.find(query.aggregate);
    if (!aggregate) throw new NotFoundException(`unknown aggregate '${query.aggregate}'`);
    const points = await this.aggregates.points(aggregate, query.timeframe, query.from, query.to, query.limit);
    return { aggregate, points };
  }
}

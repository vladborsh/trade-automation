import { Controller, Get, Inject, Query, UsePipes } from '@nestjs/common';
import { MetricsQuerySchema, MetricsResponse, bucketObservations } from '@trade-automation/contracts';
import { MetricCache } from '../../market-data/metrics/metric-cache.service';
import { METRIC_STORE, MetricStore } from '../../storage/metric-store.port';
import { ZodValidationPipe } from '../zod-validation.pipe';

/**
 * architecture/chart-layouts.md §4.5 — GET /api/metrics. "served from MetricCache when
 * in-window, else MetricStore" (same cache-then-store precedent as CandlesController), then
 * bucketed to the requested timeframe via `bucketObservations`.
 */
@Controller('api/metrics')
export class MetricsController {
  constructor(
    private readonly cache: MetricCache,
    @Inject(METRIC_STORE) private readonly store: MetricStore,
  ) {}

  @Get()
  @UsePipes(new ZodValidationPipe(MetricsQuerySchema))
  async get(@Query() query: ReturnType<typeof MetricsQuerySchema.parse>): Promise<MetricsResponse> {
    const { instrument, metric, timeframe, from, to, limit } = query;

    // Same fix as CandlesController: prefer whatever tail the cache actually holds and
    // fall back to the store only for the older portion, rather than requiring the
    // cache to cover the entire [from, to] range (too strict for a wide-open `from`).
    const cached = this.cache.query(instrument, metric, from, to);
    let observations: typeof cached;
    if (cached.length > 0) {
      const storeTo = cached[0].time - 1;
      const older = from <= storeTo ? await this.store.query(instrument, metric, from, storeTo) : [];
      observations = [...older, ...cached];
    } else {
      observations = await this.store.query(instrument, metric, from, to);
    }

    const points = bucketObservations(observations, timeframe);
    return points.slice(Math.max(0, points.length - limit));
  }
}

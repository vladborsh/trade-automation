import { Controller, Get } from '@nestjs/common';
import { HealthResponse, TIMEFRAME_MS } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { CalendarIngestionService } from '../calendar/calendar-ingestion.service';
import { MarketDataStatusService } from '../market-data/market-data-status.service';
import { MetricIngestionService } from '../market-data/metrics/metric-ingestion.service';
import { AggregateMetricsService } from '../market-data/metrics/aggregate-metrics.service';

const START_TIME = Date.now();

/**
 * architecture/live-signal-server.md §3.5, §4.8 — GET /api/health, for the load balancer and
 * for "a closed 1m candle is late if none arrived within 15s of the boundary."
 */
@Controller('api/health')
export class HealthController {
  constructor(
    private readonly config: AppConfigService,
    private readonly status: MarketDataStatusService,
    private readonly metricIngestion: MetricIngestionService,
    private readonly calendarIngestion: CalendarIngestionService,
    private readonly aggregateMetrics: AggregateMetricsService,
  ) {}

  @Get()
  get(): HealthResponse {
    const now = Date.now();
    const instruments = this.config.instruments.map((instrument) => {
      const s = this.status.get(instrument.id);
      const lastClosedCandleAge = s.lastClosedCandleTime !== null ? now - s.lastClosedCandleTime : null;
      const expectedBoundary = Math.floor(now / 60_000) * 60_000;
      const feedLag =
        s.lastClosedCandleTime !== null ? Math.max(0, expectedBoundary - 60_000 - s.lastClosedCandleTime) : null;
      return {
        instrument: instrument.id,
        lastClosedCandleAge,
        gapCount24h: s.gapCount24h.length,
        feedLag,
        backfillStatus: (Object.keys(TIMEFRAME_MS) as (keyof typeof TIMEFRAME_MS)[]).map((timeframe) => ({
          timeframe,
          status: this.status.getBackfillStatus(instrument.id, timeframe),
        })),
      };
    });

    const degraded = instruments.some(
      (i) => i.lastClosedCandleAge !== null && i.lastClosedCandleAge > 15_000 + 60_000,
    );

    return {
      status: degraded ? 'degraded' : 'ok',
      uptimeSeconds: (now - START_TIME) / 1000,
      instruments,
      metrics: this.metricIngestion.status(),
      aggregates: this.aggregateMetrics.health(now),
      calendar: this.config.env.get('CALENDAR_ENABLED') ? this.calendarIngestion.healthStatus() : null,
    };
  }
}

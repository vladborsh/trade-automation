import { Controller, Get } from '@nestjs/common';
import { HealthResponse, TIMEFRAME_MS } from '@trade-automation/contracts';
import { Public } from '../auth/public.decorator';
import { AppConfigService } from '../config/config.service';
import { CalendarIngestionService } from '../calendar/calendar-ingestion.service';
import { MarketDataStatusService } from '../market-data/market-data-status.service';
import { MetricIngestionService } from '../market-data/metrics/metric-ingestion.service';

const START_TIME = Date.now();

/**
 * architecture/live-signal-server.md §3.5, §4.8 — GET /api/health, for the load balancer and
 * for "a closed 1m candle is late if none arrived within 15s of the boundary."
 */
@Public() // for the load balancer, not the user (backtest-app-system-design.md §7.1)
@Controller('api/health')
export class HealthController {
  constructor(
    private readonly config: AppConfigService,
    private readonly status: MarketDataStatusService,
    private readonly metricIngestion: MetricIngestionService,
    private readonly calendarIngestion: CalendarIngestionService,
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
        venueStatus: s.venueStatus,
        backfillStatus: (Object.keys(TIMEFRAME_MS) as (keyof typeof TIMEFRAME_MS)[]).map((timeframe) => ({
          timeframe,
          status: this.status.getBackfillStatus(instrument.id, timeframe),
        })),
      };
    });

    // BUG-021: a stale bar is one way to be degraded and the venue saying so is another — a venue
    // failing every poll (a rejected key) can still have a recent last bar, which is exactly how
    // Capital.com sat 25-41 h stale with `/api/health` reporting `ok`. Only `'degraded'` counts
    // here, not `'down'` or `'closed'`: an instrument is `'down'` until its warm-up finishes, and a
    // closed market is not a fault, so neither should colour the whole server's status.
    const degraded = instruments.some(
      (i) =>
        (i.lastClosedCandleAge !== null && i.lastClosedCandleAge > 15_000 + 60_000) ||
        i.venueStatus === 'degraded',
    );

    return {
      status: degraded ? 'degraded' : 'ok',
      uptimeSeconds: (now - START_TIME) / 1000,
      instruments,
      metrics: this.metricIngestion.status(),
      calendar: this.config.env.get('CALENDAR_ENABLED') ? this.calendarIngestion.healthStatus() : null,
    };
  }
}

import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { ObservabilityModule } from '../observability/observability.module';
import { StorageModule } from '../storage/storage.module';
import { CandleCache } from './candle-cache.service';
import { ResamplerService } from './resampler.service';
import { GapRepairService } from './gap-repair.service';
import { BarClock } from './bar-clock.service';
import { MarketDataStatusService } from './market-data-status.service';
import { IngestionService } from './ingestion.service';
import { MetricCache } from './metrics/metric-cache.service';
import { MetricIngestionService } from './metrics/metric-ingestion.service';
import { VENUE_ADAPTERS_MAP, buildVenueAdapters } from './venue-adapters.provider';

@Module({
  imports: [AppConfigModule, StorageModule, ObservabilityModule],
  providers: [
    CandleCache,
    ResamplerService,
    GapRepairService,
    BarClock,
    MarketDataStatusService,
    IngestionService,
    MetricCache,
    MetricIngestionService,
    // architecture/live-signal-server.md §12.5 item 4: CandlesController needs the same
    // VenueAdapter instances IngestionService streams/backfills through (one CapitalComSession
    // per venue, not a duplicate that logs in twice) to do on-demand fetch-and-persist on a
    // store-miss. Built once, injected everywhere that needs venue access.
    {
      provide: VENUE_ADAPTERS_MAP,
      useFactory: (config: AppConfigService) => buildVenueAdapters(config),
      inject: [AppConfigService],
    },
  ],
  exports: [
    CandleCache,
    MarketDataStatusService,
    ResamplerService,
    MetricCache,
    MetricIngestionService,
    VENUE_ADAPTERS_MAP,
    IngestionService,
    // architecture/economic-calendar.md §3.2 — CalendarIngestionService/NotificationSchedulerService
    // ride this same BarClock tick, mirroring MetricIngestionService's own use of it.
    BarClock,
  ],
})
export class MarketDataModule {}

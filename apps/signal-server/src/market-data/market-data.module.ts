import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
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
  ],
  exports: [CandleCache, MarketDataStatusService, ResamplerService, MetricCache, MetricIngestionService],
})
export class MarketDataModule {}

import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { ObservabilityModule } from '../observability/observability.module';
import { StorageModule } from '../storage/storage.module';
import { EXECUTION_PORT, NoopExecution } from './execution.port';
import { IndicatorCache } from './indicator-cache.service';
import { StrategyRegistryService } from './strategy-registry.service';
import { StrategyRunnerService } from './strategy-runner.service';

@Module({
  imports: [AppConfigModule, MarketDataModule, StorageModule, ObservabilityModule],
  providers: [
    StrategyRegistryService,
    StrategyRunnerService,
    IndicatorCache,
    { provide: EXECUTION_PORT, useClass: NoopExecution },
  ],
  exports: [StrategyRegistryService, StrategyRunnerService, IndicatorCache],
})
export class StrategyEngineModule {}

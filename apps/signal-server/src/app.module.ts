import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ApiModule } from './api/api.module';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './observability/health.module';
import { ObservabilityModule } from './observability/observability.module';
import { MarketDataModule } from './market-data/market-data.module';
import { StorageModule } from './storage/storage.module';
import { StrategyEngineModule } from './strategy-engine/strategy-engine.module';

@Module({
  imports: [
    AppConfigModule,
    EventEmitterModule.forRoot(),
    ObservabilityModule,
    HealthModule,
    StorageModule,
    MarketDataModule,
    StrategyEngineModule,
    ApiModule,
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { ObservabilityModule } from '../observability/observability.module';
import { StorageModule } from '../storage/storage.module';
import { StrategyEngineModule } from '../strategy-engine/strategy-engine.module';
import { InstrumentsController } from './rest/instruments.controller';
import { CandlesController } from './rest/candles.controller';
import { SignalsController } from './rest/signals.controller';
import { StrategiesController } from './rest/strategies.controller';
import { IndicatorsController } from './rest/indicators.controller';
import { LayoutsController } from './rest/layouts.controller';
import { MetricsController } from './rest/metrics.controller';
import { LiveGateway } from './ws/live.gateway';

@Module({
  imports: [AppConfigModule, MarketDataModule, StorageModule, StrategyEngineModule, ObservabilityModule],
  controllers: [
    InstrumentsController,
    CandlesController,
    SignalsController,
    StrategiesController,
    IndicatorsController,
    LayoutsController,
    MetricsController,
  ],
  providers: [LiveGateway],
})
export class ApiModule {}

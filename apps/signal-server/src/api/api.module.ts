import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AuthModule } from '../auth/auth.module';
import { BacktestModule } from '../backtest/backtest.module';
import { CalendarModule } from '../calendar/calendar.module';
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
import { CalendarController } from './rest/calendar.controller';
import { BacktestInstrumentsController } from './rest/backtest/instruments.controller';
import { AuthController } from './rest/auth.controller';
import { AdminController } from './rest/admin.controller';
import { SessionsController } from './rest/backtest/sessions.controller';
import { BacktestCandlesController } from './rest/backtest/candles.controller';
import { OrdersController } from './rest/backtest/orders.controller';
import { LiveGateway } from './ws/live.gateway';

@Module({
  imports: [
    AppConfigModule,
    MarketDataModule,
    StorageModule,
    StrategyEngineModule,
    ObservabilityModule,
    CalendarModule,
    AuthModule,
    BacktestModule,
  ],
  controllers: [
    InstrumentsController,
    CandlesController,
    SignalsController,
    StrategiesController,
    IndicatorsController,
    LayoutsController,
    MetricsController,
    CalendarController,
    BacktestInstrumentsController,
    AuthController,
    AdminController,
    SessionsController,
    BacktestCandlesController,
    OrdersController,
  ],
  providers: [LiveGateway],
})
export class ApiModule {}

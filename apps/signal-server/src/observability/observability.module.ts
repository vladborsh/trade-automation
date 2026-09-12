import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * architecture/live-signal-server.md §4.8 — structured JSON logs (pino via nestjs-pino), one
 * line per event with instrument/strategyId/event fields; /metrics (prom-client).
 * Deliberately does not import MarketDataModule (see HealthModule) to avoid a module cycle,
 * since MarketDataModule/StorageModule/StrategyEngineModule import this module for metrics.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.env.get('LOG_LEVEL'),
          autoLogging: true,
          transport:
            config.env.get('NODE_ENV') === 'development' ? { target: 'pino-pretty' } : undefined,
        },
      }),
    }),
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}

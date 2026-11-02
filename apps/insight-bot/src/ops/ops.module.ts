import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { BinanceWeightTracker } from '../venues/binance/binance-weight.tracker';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { StreamRegistry } from './stream-registry';

/**
 * architecture/insight-bot-system-design.md §2.1 (`ops/`), §6.1 — `/health`, `/metrics`, and
 * the structured JSON logs every module writes through (pino via nestjs-pino). The watchdog and
 * the daily gap report (§6.2) join this module with IB-008.
 *
 * `StreamRegistry` and `MetricsService` are exported because the collectors write to them.
 * IB-063: `BinanceWeightTracker` lives here too, so the collectors and the web module's on-demand
 * candles record into ONE instance — the one `/health` reads. Two trackers would each report half
 * of what the IP spent.
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
          transport: config.env.get('NODE_ENV') === 'development' ? { target: 'pino-pretty' } : undefined,
        },
      }),
    }),
  ],
  controllers: [HealthController, MetricsController],
  providers: [MetricsService, StreamRegistry, BinanceWeightTracker],
  exports: [MetricsService, StreamRegistry, BinanceWeightTracker],
})
export class OpsModule {}

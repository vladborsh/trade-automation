import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { VenuesModule } from '../venues/venues.module';
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
 * IB-063: the collectors and the web module's on-demand reads record into ONE `BinanceWeightTracker`
 * — the one `/health` reads. WD-008 moved its provider to `VenuesModule`, which this module imports
 * and re-exports, so every importer of OpsModule still gets that same instance.
 */
@Module({
  imports: [
    AppConfigModule,
    VenuesModule,
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
  providers: [MetricsService, StreamRegistry],
  exports: [MetricsService, StreamRegistry, VenuesModule],
})
export class OpsModule {}

import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { VenuesModule } from '../venues/venues.module';
import { HealthController } from './health.controller';
import { loggerModuleParams } from './http-log';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { StreamRegistry } from './stream-registry';

/**
 * architecture/insight-bot-system-design.md §2.1 (`ops/`), §6.1 — the liveness probe `/healthz`
 * (WD-011: `{ status }` only; it was `/health`), `/metrics`, and the structured JSON logs every
 * module writes through (pino via nestjs-pino). The watchdog is provided by `CollectorsModule`.
 *
 * `StreamRegistry` and `MetricsService` are exported because the collectors write to them.
 * IB-063: the collectors and the web module's on-demand reads record into ONE `BinanceWeightTracker`
 * — the one `/metrics` and the admin health page read. WD-008 moved its provider to `VenuesModule`, which this module imports
 * and re-exports, so every importer of OpsModule still gets that same instance.
 */
@Module({
  imports: [
    AppConfigModule,
    VenuesModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      // IB-BUG-031: no cookie, Authorization, Set-Cookie or URL token ever reaches a log line
      useFactory: (config: AppConfigService) => loggerModuleParams(config.env.get('LOG_LEVEL'), config.env.get('NODE_ENV')),
    }),
  ],
  controllers: [HealthController, MetricsController],
  providers: [MetricsService, StreamRegistry],
  exports: [MetricsService, StreamRegistry, VenuesModule],
})
export class OpsModule {}

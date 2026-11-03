import { DynamicModule, Logger, Module } from '@nestjs/common';
import { FfFeedClient } from '@trade-automation/calendar-core';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/config.service';
import { DbModule } from '../../db/db.module';
import { OpsModule } from '../../ops/ops.module';
import { WritersModule } from '../writers/writers.module';
import { CalendarCollectorService } from './calendar-collector.service';
import { CalendarRepository } from './calendar.repository';
import { FEED_CLIENT } from './feed-client.token';

/**
 * architecture/insight-bot-system-design.md §2.1 (`collectors/calendar`), §3.3 — the calendar
 * collector.
 *
 * **Dynamic, and that is the whole point (IB-BUG-001).** IB-003's rule is that `DATABASE_URL` has
 * no default and the app still boots and serves `/healthz` and `/metrics` without one. This module
 * needs `WritersModule`, and `Writers` throws at construction when there is no database — so a
 * static `imports: [WritersModule]` turned a missing `DATABASE_URL` into a boot failure, exactly
 * the thing `writers.module.ts`'s docblock warns about. `register()` therefore provides **nothing**
 * when there is no database, the same shape as `CollectorsModule.register()`.
 *
 * It reads `process.env` rather than `AppConfigService` because the module graph is built before
 * any provider exists — there is no DI to ask yet. That is safe here for the one thing it checks:
 * `DATABASE_URL` has no default and no coercion (`env.schema.ts`), so the validated value and the
 * raw one are the same string.
 *
 * `CALENDAR_ENABLED=false` is a *different* switch and still works the way it did: the module is
 * wired, the collector is constructed, and it no-ops in `onApplicationBootstrap`.
 */
@Module({})
export class CalendarModule {
  static register(): DynamicModule {
    const connectionString = process.env.DATABASE_URL;
    if (typeof connectionString !== 'string' || connectionString.length === 0) {
      new Logger(CalendarModule.name).warn(
        'DATABASE_URL is not set — calendar collector disabled (the app still serves /healthz and /metrics)',
      );
      return { module: CalendarModule };
    }

    return {
      module: CalendarModule,
      imports: [AppConfigModule, DbModule, OpsModule, WritersModule],
      providers: [
        CalendarRepository,
        CalendarCollectorService,
        {
          provide: FEED_CLIENT,
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => new FfFeedClient(config.env.get('CALENDAR_FEED_BASE_URL')),
        },
      ],
      exports: [CalendarCollectorService, CalendarRepository],
    };
  }
}

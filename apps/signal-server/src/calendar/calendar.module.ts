import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { MarketDataModule } from '../market-data/market-data.module';
import { ObservabilityModule } from '../observability/observability.module';
import { StorageModule } from '../storage/storage.module';
import { CalendarCache } from './calendar-cache.service';
import { CalendarIngestionService } from './calendar-ingestion.service';
import { ActualsBackfillService } from './actuals-backfill.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { FfFeedClient } from './feed/ff-feed.client';
import { FixtureFeedClient } from './feed/fixture-feed.client';
import { FEED_CLIENT } from './feed/feed-client.token';

/**
 * architecture/economic-calendar.md §2.1 D1, §3 — new Nest module, same process as everything
 * else (no new deployable). CALENDAR_ENABLED=false leaves this module wired but every service
 * checks the flag in onApplicationBootstrap and no-ops (§8) — CalendarController gates its
 * routes on the same flag (calendar.controller.ts).
 */
@Module({
  imports: [AppConfigModule, StorageModule, MarketDataModule, ObservabilityModule],
  providers: [
    CalendarCache,
    ActualsBackfillService,
    CalendarIngestionService,
    NotificationSchedulerService,
    {
      provide: FEED_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        if (config.env.get('MARKET_DATA_MODE') === 'replay') {
          return new FixtureFeedClient(config.env.get('REPLAY_FIXTURES_DIR'));
        }
        return new FfFeedClient(config.env.get('CALENDAR_FEED_BASE_URL'));
      },
    },
  ],
  exports: [CalendarCache, CalendarIngestionService, ActualsBackfillService, NotificationSchedulerService],
})
export class CalendarModule {}

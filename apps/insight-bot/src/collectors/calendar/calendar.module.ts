import { Module } from '@nestjs/common';
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
 * collector. Like every collector it imports `WritersModule` itself (that module is deliberately
 * not in `AppModule`, because `Writers` requires a database and the app must still boot without
 * one — IB-003).
 */
@Module({
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
})
export class CalendarModule {}

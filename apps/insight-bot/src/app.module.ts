import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { NewsModule } from './news/news.module';
import { WebModule } from './web/web.module';
import { DashboardStaticModule } from './web/static.module';
import { DeliveryModule } from './delivery/delivery.module';
import { CollectorsModule } from './collectors/collectors.module';
import { OpsModule } from './ops/ops.module';
import { CalendarModule } from './collectors/calendar/calendar.module';

/**
 * architecture/insight-bot-system-design.md §2.1. IB-003 wires the three modules the rest hang
 * off: config (env + universe), db (migrations + the `Db` port), ops (/health, /metrics, logs).
 * IB-010 adds `collectors/calendar` and IB-005 the Binance USD-M perp collector. **Both register
 * dynamically and provide nothing without `DATABASE_URL`**, so the app still boots and serves
 * /health and /metrics without a database, which is IB-003's rule (IB-BUG-001 fixed the calendar
 * side, which had imported `WritersModule` statically). `CALENDAR_ENABLED=false` is a separate
 * switch that leaves the module wired and stops the polling.
 *
 * WD-010 (wind-down; storage ruling 2026-11-03): the accumulation layer is gone — derive, features
 * and backfill. What the box still collects is what a venue forgets: liquidations (three
 * websockets), Binance OI/LS (the poller) and the calendar. News stays wired exactly as before
 * (owner hold 2026-11-03).
 */
@Module({
  imports: [AppConfigModule, OpsModule, DbModule, CalendarModule.register(), CollectorsModule.register(), DeliveryModule.register(), NewsModule.register(), WebModule.register(), DashboardStaticModule.register()],
})
export class AppModule {}

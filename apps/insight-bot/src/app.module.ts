import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { OpsModule } from './ops/ops.module';
import { CalendarModule } from './collectors/calendar/calendar.module';

/**
 * architecture/insight-bot-system-design.md §2.1. IB-003 wires the three modules the rest hang
 * off: config (env + universe), db (migrations + the `Db` port), ops (/health, /metrics, logs).
 * IB-010 adds the first collector, `collectors/calendar` (it brings `WritersModule`, so this
 * app now needs `DATABASE_URL` to boot — CALENDAR_ENABLED=false still disables the polling).
 * The remaining `collectors/`, `derive/`, `features/`, `regime/`, `playbooks/`, `gate/`, `delivery/`,
 * `tracker/` and `users/` arrive with their own tasks.
 */
@Module({
  imports: [AppConfigModule, OpsModule, DbModule, CalendarModule],
})
export class AppModule {}

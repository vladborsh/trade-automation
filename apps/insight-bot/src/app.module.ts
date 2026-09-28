import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { CollectorsModule } from './collectors/collectors.module';
import { OpsModule } from './ops/ops.module';
import { CalendarModule } from './collectors/calendar/calendar.module';

/**
 * architecture/insight-bot-system-design.md §2.1. IB-003 wires the three modules the rest hang
 * off: config (env + universe), db (migrations + the `Db` port), ops (/health, /metrics, logs).
 * IB-010 adds `collectors/calendar` and IB-005 the Binance USD-M perp collector, which
 * `CollectorsModule.register()` provides only when `DATABASE_URL` is set. The remaining
 * `collectors/`, `derive/`, `features/`, `regime/`, `playbooks/`, `gate/`, `delivery/`,
 * `tracker/` and `users/` arrive with their own tasks.
 */
@Module({
  imports: [AppConfigModule, OpsModule, DbModule, CalendarModule, CollectorsModule.register()],
})
export class AppModule {}

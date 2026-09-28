import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
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
 * switch that leaves the module wired and stops the polling. The remaining `collectors/`,
 * `derive/`, `features/`, `regime/`, `playbooks/`, `gate/`, `delivery/`, `tracker/` and `users/`
 * arrive with their own tasks.
 */
@Module({
  imports: [AppConfigModule, OpsModule, DbModule, CalendarModule.register(), CollectorsModule.register()],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { OpsModule } from './ops/ops.module';

/**
 * architecture/insight-bot-system-design.md §2.1. IB-003 wires the three modules the rest hang
 * off: config (env + universe), db (migrations + the `Db` port), ops (/health, /metrics, logs).
 * `collectors/`, `derive/`, `features/`, `regime/`, `playbooks/`, `gate/`, `delivery/`,
 * `tracker/` and `users/` arrive with their own tasks.
 */
@Module({
  imports: [AppConfigModule, OpsModule, DbModule],
})
export class AppModule {}

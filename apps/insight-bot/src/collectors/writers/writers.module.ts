import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { OpsModule } from '../../ops/ops.module';
import { Writers } from './batch-writer';

/**
 * architecture/insight-bot-system-design.md §2.1 (`collectors/writers`).
 *
 * **Deliberately not imported by `AppModule` yet.** `Writers` requires a database, and the app
 * must keep booting without `DATABASE_URL` (§7, IB-003) — Nest instantiates providers eagerly,
 * so importing this module would turn a missing `DATABASE_URL` into a boot failure. The first
 * collector module (IB-005) imports it, and by then a collector without a database is a
 * misconfiguration worth failing on.
 */
@Module({
  imports: [DbModule, OpsModule],
  providers: [Writers],
  exports: [Writers],
})
export class WritersModule {}

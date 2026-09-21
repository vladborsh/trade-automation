import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { DB, Db } from '../db/db.port';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';
import { PgBacktestRepositories } from './pg/pg-backtest-repositories';
import { BACKTEST_REPOSITORIES } from './session.repository.port';
import { AdvanceService } from './advance.service';
import { OrderService } from './order.service';
import { ReplayAheadService } from './replay-ahead.service';
import { ReplayHistoryService } from './replay-history.service';
import { SessionService } from './session.service';

/**
 * architecture/backtest-app-system-design.md §2.2 `backtest/`. `BACKTEST_REPOSITORIES` is null
 * when `DB` is (no `DATABASE_URL`), and every backtest route then answers 503.
 */
@Module({
  imports: [AppConfigModule, DbModule, StorageModule],
  providers: [
    { provide: BACKTEST_REPOSITORIES, inject: [DB], useFactory: (db: Db | null) => (db ? new PgBacktestRepositories(db) : null) },
    SessionService,
    ReplayHistoryService,
    ReplayAheadService,
    OrderService,
    AdvanceService,
  ],
  exports: [SessionService, ReplayHistoryService, ReplayAheadService, OrderService, AdvanceService],
})
export class BacktestModule {}

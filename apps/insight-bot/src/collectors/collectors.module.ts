import { DynamicModule, Logger, Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { OpsModule } from '../ops/ops.module';
import { BinancePerpService } from './binance-perp/binance-perp.service';
import { WritersModule } from './writers/writers.module';

/**
 * IB-005 — the collectors, registered only when there is a database to write into.
 *
 * `Writers` throws without `DATABASE_URL` (IB-004), and the app must still boot without one
 * (IB-003, §2.1): so this is a dynamic module that provides nothing in that case and says why,
 * the same rule `DbModule` follows.
 */
@Module({})
export class CollectorsModule {
  static register(): DynamicModule {
    const enabled = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
    if (!enabled) {
      new Logger(CollectorsModule.name).warn('DATABASE_URL is not set — collectors disabled (the app still serves /health and /metrics)');
      return { module: CollectorsModule };
    }
    return {
      module: CollectorsModule,
      imports: [AppConfigModule, DbModule, OpsModule, WritersModule],
      providers: [BinancePerpService],
    };
  }
}

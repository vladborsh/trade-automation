import { DynamicModule, Logger, Module } from '@nestjs/common';
import { WritersModule } from '../collectors/writers/writers.module';
import { DbModule } from '../db/db.module';
import { AppConfigModule } from '../config/config.module';
import { DeriveRunner } from './derive.runner';

/**
 * IB-014 — the derive job (design §8.1). Dynamic for the same reason the collectors are: it needs a
 * database, and the app must still boot and serve /health without one (IB-003, IB-BUG-001).
 */
@Module({})
export class DeriveModule {
  static register(): DynamicModule {
    const enabled = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
    if (!enabled) {
      new Logger(DeriveModule.name).warn('DATABASE_URL is not set — derive disabled (the app still serves /health and /metrics)');
      return { module: DeriveModule };
    }
    return {
      module: DeriveModule,
      imports: [AppConfigModule, DbModule, WritersModule],
      providers: [DeriveRunner],
    };
  }
}

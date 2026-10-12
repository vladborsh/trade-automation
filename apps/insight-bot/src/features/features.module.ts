import { DynamicModule, Logger, Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { FeaturesRunner } from './features.runner';

/**
 * IB-015 — the feature pass (design §8.1). Dynamic for the same reason the derive job is: it
 * needs a database, and the app must still boot and serve /health without one (IB-003,
 * IB-BUG-001).
 */
@Module({})
export class FeaturesModule {
  static register(): DynamicModule {
    const enabled = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
    if (!enabled) {
      new Logger(FeaturesModule.name)
        .warn('DATABASE_URL is not set — the feature pass is disabled (the app still serves /health)');
      return { module: FeaturesModule };
    }
    return {
      module: FeaturesModule,
      imports: [AppConfigModule, DbModule],
      providers: [FeaturesRunner],
    };
  }
}

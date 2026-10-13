import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { DexService } from './dex.service';

/**
 * IB-028 — the DEX snapshot collector (§10).
 *
 * Registered only when a database is configured, like `NewsModule` and `CollectorsModule`: this
 * service exists to write a history, and one that polls three venues and discards the result would
 * spend the measured rate budget for nothing.
 *
 * No `AppConfigModule` here, unlike the news ingest: the networks and listings are the design's
 * four and two, not configured symbols, so there is no dictionary to come back empty. If that ever
 * becomes configurable, import it — the news ingest stored 366 articles with zero tags because the
 * module did not.
 */
@Module({})
export class DexModule {
  static register(): DynamicModule {
    const enabled = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
    if (!enabled) {
      new Logger(DexModule.name).log('DATABASE_URL is not set — DEX snapshots disabled');
      return { module: DexModule };
    }
    return { module: DexModule, imports: [DbModule], providers: [DexService] };
  }
}

import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { NewsService } from './news.service';
import { ReactionService } from './reaction.service';

/**
 * IB-027 — the news ingest (§10).
 *
 * Registered only when a database is configured, like `CollectorsModule`: the ingest writes on
 * every pass and has nothing useful to do without one, and a service that polls ten feeds and
 * discards the result is worse than one that does not start.
 */
@Module({})
export class NewsModule {
  static register(): DynamicModule {
    const enabled = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
    if (!enabled) {
      new Logger(NewsModule.name).log('DATABASE_URL is not set — news ingest disabled');
      return { module: NewsModule };
    }
    return { module: NewsModule, imports: [DbModule], providers: [NewsService, ReactionService] };
  }
}

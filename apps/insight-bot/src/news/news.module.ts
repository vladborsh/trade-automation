import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { NewsService } from './news.service';
import { ReactionService } from './reaction.service';

/**
 * IB-027 — the news ingest (§10).
 *
 * Registered only when a database is configured, like `CollectorsModule`: the ingest writes on
 * every pass and has nothing useful to do without one, and a service that polls ten feeds and
 * discards the result is worse than one that does not start.
 *
 * **`AppConfigModule` is imported, not assumed.** It is not `@Global`, so without it Nest injects
 * `undefined` for the optional `AppConfigService`, the symbol dictionary comes back empty and every
 * article is stored with no tags — silently, because an untagged article and an article about
 * nothing look identical. Found on the first live pass: 366 real articles, zero tags, all unit
 * tests green, because the specs construct the service with a config object directly.
 */
@Module({})
export class NewsModule {
  static register(): DynamicModule {
    const enabled = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
    if (!enabled) {
      new Logger(NewsModule.name).log('DATABASE_URL is not set — news ingest disabled');
      return { module: NewsModule };
    }
    return { module: NewsModule, imports: [AppConfigModule, DbModule], providers: [NewsService, ReactionService] };
  }
}

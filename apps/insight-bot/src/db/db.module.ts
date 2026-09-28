import { Inject, Logger, Module, OnModuleInit } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { Db, DB } from './db.port';
import { runMigrations } from './migration-runner';
import { PgDatabase } from './pg/pg-database';
import { syncUniverse } from './universe-sync';

/** The slice of `AppConfigService` this module needs — narrow so it is trivial to fake in tests. */
export interface DbEnvSource {
  env: { get(key: 'DATABASE_URL' | 'DB_MIGRATE_ON_BOOT'): unknown };
}

/**
 * Pure factory, exported so it is unit-testable without booting Nest's `ConfigModule` (which
 * validates `process.env` once, synchronously, the first time `config.module.ts` is imported
 * in a process — mutating `process.env` afterwards in a test has no effect on it).
 */
export function createDb(config: DbEnvSource): Db | null {
  const connectionString = config.env.get('DATABASE_URL');
  return typeof connectionString === 'string' && connectionString.length > 0
    ? new PgDatabase(connectionString)
    : null;
}

/**
 * architecture/insight-bot-system-design.md §2.1, §7 — `DATABASE_URL` has **no default**: this
 * module is enabled only when it is explicitly set, the same rule as signal-server's
 * `db.module.ts`, so a slot that forgets it boots with the DB disabled rather than writing into
 * another slot's database. With no `DATABASE_URL` the `DB` token resolves to `null`.
 *
 * When it is set, migrations run at boot iff `DB_MIGRATE_ON_BOOT` (default true) and
 * `config/universe.yaml` is then loaded into `symbols` (§3.2). A failed migration or a failed
 * universe load is a boot failure, like an invalid env.
 */
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: DB,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => createDb(config),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnModuleInit {
  private readonly logger = new Logger(DbModule.name);

  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) private readonly db: Db | null,
  ) {}

  async onModuleInit(): Promise<void> {
    const connectionString = this.config.env.get('DATABASE_URL');
    if (!connectionString || !this.db) {
      this.logger.log('DATABASE_URL not set — DbModule disabled, the app boots without a database.');
      return;
    }
    if (this.config.env.get('DB_MIGRATE_ON_BOOT')) {
      const result = await runMigrations({ connectionString });
      if (result.applied.length === 0) {
        this.logger.log('Migrations: already up to date, nothing applied.');
      } else {
        const summary = result.applied.map((m) => `${m.version}.${m.action}.${m.name}`).join(', ');
        this.logger.log(`Migrations: applied ${result.applied.length} — ${summary}`);
      }
    } else {
      this.logger.log('DB_MIGRATE_ON_BOOT=false — skipping migrations at boot.');
    }

    // §3.2 — `symbols` is loaded from universe.yaml on boot. Deliberately after migrations:
    // with DB_MIGRATE_ON_BOOT=false the table is expected to exist already, and a missing one
    // must fail loudly rather than leave the collectors with an empty universe.
    const sync = await syncUniverse(this.db, this.config.universe);
    const deactivated = sync.deactivated.length > 0 ? `, deactivated ${sync.deactivated.join(', ')}` : '';
    this.logger.log(`Universe: ${sync.upserted} symbols loaded from ${this.config.env.get('UNIVERSE_FILE')}${deactivated}`);
  }
}

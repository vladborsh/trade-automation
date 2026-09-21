import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { Db, DB } from './db.port';
import { PgDatabase } from './pg/pg-database';
import { runMigrations } from './migration-runner';

/** The slice of `AppConfigService` this module needs — narrow so it is trivial to fake in tests. */
export interface DbEnvSource {
  env: { get(key: 'DATABASE_URL' | 'DB_MIGRATE_ON_BOOT'): unknown };
}

/**
 * Pure factory, exported so it is unit-testable without booting Nest's `ConfigModule` (which
 * validates `process.env` once, synchronously, the first time `config.module.ts` is imported
 * in a process — mutating `process.env` afterwards in a test has no effect on it, a real gotcha
 * hit writing this module's own test).
 */
export function createDb(config: DbEnvSource): Db | null {
  const connectionString = config.env.get('DATABASE_URL');
  return typeof connectionString === 'string' && connectionString.length > 0
    ? new PgDatabase(connectionString)
    : null;
}

/**
 * architecture/backtest-app-system-design.md §2.2, §4, §12.8 — `DATABASE_URL` has **no
 * default**: this module is enabled only when it is explicitly set, the same
 * `CALENDAR_ENABLED=false` pattern used for the economic calendar (`calendar.module.ts`,
 * `env.schema.ts`). With no `DATABASE_URL`, the `DB` token resolves to `null` and this
 * module does nothing at boot — every route this server already serves works exactly as
 * before (nothing in the pre-existing codebase depends on `DB`; the auth/backtest modules
 * that will inject it are T-007/T-013, out of scope here).
 *
 * When `DATABASE_URL` is set, migrations run at boot iff `DB_MIGRATE_ON_BOOT` is true
 * (default) — a failed migration is a boot failure, like an invalid env (§4).
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

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    const connectionString = this.config.env.get('DATABASE_URL');
    if (!connectionString) {
      this.logger.log('DATABASE_URL not set — DbModule disabled, server boots without a database.');
      return;
    }
    if (!this.config.env.get('DB_MIGRATE_ON_BOOT')) {
      this.logger.log('DB_MIGRATE_ON_BOOT=false — skipping migrations at boot.');
      return;
    }
    const result = await runMigrations({ connectionString });
    if (result.applied.length === 0) {
      this.logger.log('Migrations: already up to date, nothing applied.');
    } else {
      const summary = result.applied.map((m) => `${m.version}.${m.action}.${m.name}`).join(', ');
      this.logger.log(`Migrations: applied ${result.applied.length} — ${summary}`);
    }
  }
}

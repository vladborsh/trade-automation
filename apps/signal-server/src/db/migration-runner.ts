import { Client } from 'pg';
import Postgrator = require('postgrator');

const ADVISORY_LOCK_KEY = "hashtext('bt-migrate')";

export interface MigrationRunnerOptions {
  connectionString: string;
  /** Defaults to `<repo>/apps/signal-server/migrations/*`, resolved relative to this file. */
  migrationPattern?: string;
}

export interface MigrationResult {
  /** Migrations postgrator actually applied this run — empty when already up to date. */
  applied: Array<{ version: number; action: 'do' | 'undo'; name: string }>;
}

/**
 * architecture/backtest-app-system-design.md §4, §6 (D6) — postgrator (driver `pg`,
 * `migrationPattern: 'migrations/*'`, `schemaTable: 'schema_migrations'`) wrapped in
 * `pg_advisory_lock(hashtext('bt-migrate'))` so two slots booting against the same
 * Postgres instance (one server, one database per slot — §4) never race the migration
 * runner against each other. The lock is session-scoped, so it is taken and released on the
 * one dedicated `pg.Client` this function opens and closes itself.
 */
export async function runMigrations(options: MigrationRunnerOptions): Promise<MigrationResult> {
  const migrationPattern = options.migrationPattern ?? `${__dirname}/../../migrations/*`;
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`);
    try {
      const postgrator = new Postgrator({
        driver: 'pg',
        migrationPattern,
        schemaTable: 'schema_migrations',
        execQuery: (query: string) => client.query(query),
      });
      const applied = await postgrator.migrate();
      return {
        applied: applied.map((m) => ({ version: m.version, action: m.action, name: m.name })),
      };
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
    }
  } finally {
    await client.end();
  }
}

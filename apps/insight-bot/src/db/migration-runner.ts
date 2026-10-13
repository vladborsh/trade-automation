import { Client } from 'pg';
import Postgrator = require('postgrator');

const ADVISORY_LOCK_KEY = "hashtext('ib-migrate')";

export interface MigrationRunnerOptions {
  connectionString: string;
  /** Defaults to `<repo>/apps/insight-bot/migrations/*`, resolved relative to this file. */
  migrationPattern?: string;
  /** Migrate to this version (e.g. '001', which runs undo files); defaults to the latest. */
  target?: string;
}

export interface MigrationResult {
  /** Migrations postgrator actually applied this run — empty when already up to date. */
  applied: Array<{ version: number; action: 'do' | 'undo'; name: string }>;
}

/**
 * architecture/insight-bot-system-design.md §2.1, §7 — postgrator (driver `pg`,
 * `migrationPattern: 'migrations/*'`, `schemaTable: 'schema_migrations'`) wrapped in
 * `pg_advisory_lock(hashtext('ib-migrate'))` so two slots booting against the same
 * Postgres instance (one server, one database per slot — §7, AGENTS.md) never race the
 * migration runner against each other. The key is **`ib-migrate`**, not signal-server's
 * `bt-migrate`: the two apps share one local Postgres server and an advisory lock is
 * cluster-wide, so a shared key would make either app's boot wait on the other's migrations.
 * The lock is session-scoped, so it is taken and released on the one dedicated `pg.Client`
 * this function opens and closes itself.
 */
export async function runMigrations(options: MigrationRunnerOptions): Promise<MigrationResult> {
  const migrationPattern = options.migrationPattern ?? `${__dirname}/../../migrations/*`;
  const client = new Client({ connectionString: options.connectionString });
  // BUG-013: a connection error must not surface as an unhandled 'error' event. The in-flight
  // query rejects with it, so runMigrations still fails loudly, as an error rather than a crash.
  client.on('error', () => undefined);
  // A `raise notice` in a migration is invisible unless something listens: node-postgres emits
  // it as an event and drops it when nobody is attached. Migration 016 deletes rows and prints
  // a census of what it removed first — without this handler that census would be written and
  // never read, which is worse than not writing it, because the file would claim to be loud.
  client.on('notice', (notice) => {
    process.stdout.write(`migration: ${notice.message ?? String(notice)}\n`);
  });
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
      const applied = await postgrator.migrate(options.target);
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

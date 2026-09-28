/**
 * CLI entry point: `npm run migrate` (→ `node dist/db/migrate.js`). Standalone — it does not
 * boot Nest — so it can be run in CI or by hand against any `DATABASE_URL`, including a
 * migration dry run before deploying a new image (§7's deploy path).
 */
import { runMigrations } from './migration-runner';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
    return;
  }
  const result = await runMigrations({ connectionString });
  if (result.applied.length === 0) {
    // eslint-disable-next-line no-console
    console.log('Migrations: already up to date, nothing applied.');
  } else {
    for (const migration of result.applied) {
      // eslint-disable-next-line no-console
      console.log(`Migrations: applied ${migration.version}.${migration.action}.${migration.name}`);
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Migration run failed:', err);
  process.exit(1);
});

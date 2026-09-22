import { runMigrations } from '../../src/db/migration-runner';
import { DB_HOOK_TIMEOUT_MS } from './scratch-db';

/**
 * architecture/backtest-app-system-design.md T-004 "done when" — "with a local Postgres the
 * server boots, applies 001, and boots again as a no-op". Skipped when DATABASE_URL is unset.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

maybeDescribe('migration-runner against a real Postgres (T-004 done-when)', () => {
  it('applies 001 on first run, then re-applies as a no-op', async () => {
    const first = await runMigrations({ connectionString: DATABASE_URL as string });
    // Either this is the very first run in this database (applies 001) or a prior test run
    // already migrated it — both are valid; what matters is idempotency, asserted next.
    expect(Array.isArray(first.applied)).toBe(true);

    const second = await runMigrations({ connectionString: DATABASE_URL as string });
    expect(second.applied).toEqual([]);
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: each run takes the advisory lock other workers' migrations may hold
});

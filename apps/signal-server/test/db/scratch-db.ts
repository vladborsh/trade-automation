import { Client } from 'pg';

/**
 * BUG-012 — throwaway databases for the migration specs, named so that each slot can find and
 * remove only its own leftovers.
 *
 * Every slot runs these specs against the one local Postgres, concurrently. A name now carries the
 * slot's own database name (the one in DATABASE_URL, e.g. `backtest_dev3`):
 * `<kind>_<slotdb>_<random>`. Leftovers from this slot's earlier failed runs are matched by that
 * exact prefix (`starts_with`, not `LIKE`: `_` is a LIKE wildcard). They are dropped WITHOUT `FORCE`,
 * so a database still in use (a concurrent run of the same slot) makes the drop fail and is skipped,
 * never killed. Names from before BUG-012 carry no slot and are never touched.
 */
export function slotOf(databaseUrl: string): string {
  return new URL(databaseUrl).pathname.replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

export function scratchPrefix(kind: string, databaseUrl: string): string {
  return `${kind}_${slotOf(databaseUrl)}_`;
}

/** Drops this slot's leftover databases with `prefix` that nobody is using; returns what it dropped. */
export async function dropLeftovers(admin: Client, prefix: string): Promise<string[]> {
  const { rows } = await admin.query<{ datname: string }>('select datname from pg_database where starts_with(datname, $1)', [prefix]);
  const dropped: string[] = [];
  for (const { datname } of rows) {
    try {
      await admin.query(`drop database if exists "${datname.replace(/"/g, '""')}"`); // no FORCE: in use means skip
      dropped.push(datname);
    } catch {
      // in use by a concurrent run of this slot, or already gone
    }
  }
  if (dropped.length > 0) process.stderr.write(`scratch-db: removed ${dropped.length} leftover database(s): ${dropped.join(', ')}\n`);
  return dropped;
}

/**
 * Drops this run's own databases concurrently, one admin connection each (from `connect`), and logs
 * any drop that took over 2 s, so a slow teardown is visible rather than a bare timeout.
 *
 * A plain `DROP DATABASE` comes first; `FORCE` only if the database is still in use after that
 * (55006). pg-pool's `end()` resolves as soon as it has told its clients to end, before their
 * server backends have exited. An immediate `WITH (FORCE)` then terminates a backend that is
 * already shutting down (57P01), and the pool re-emits that as an unhandled `error`, which failed
 * a suite (BUG-012, run 5). A plain drop waits for those backends (Postgres allows up to 5 s)
 * instead of killing them.
 */
export async function dropOwn(connect: () => Promise<Client>, names: readonly string[]): Promise<void> {
  await Promise.all(
    names.map(async (name) => {
      const started = Date.now();
      const admin = await connect();
      try {
        try {
          await admin.query(`drop database if exists ${name}`);
        } catch (err) {
          if ((err as { code?: string }).code !== '55006') throw err; // object_in_use: something still holds it
          await admin.query(`drop database if exists ${name} with (force)`);
          process.stderr.write(`scratch-db: ${name} was still in use after 5 s; dropped WITH (FORCE)\n`);
        }
      } finally {
        await admin.end();
      }
      const ms = Date.now() - started;
      if (ms > 2000) process.stderr.write(`scratch-db: dropping ${name} took ${ms} ms\n`);
    }),
  );
}

/**
 * Jest hook timeout for creating and dropping databases. `DROP DATABASE` takes 0.3-0.7 s on an idle
 * instance, but seconds on a busy one (a full with-DB run, a Postgres fresh from
 * a restart). Jest's default 5 s hook timeout failed teardown twice after the 2026-09-22 reboot
 * (BUG-012). This is a legitimately slow operation, not a masked test.
 */
export const DB_HOOK_TIMEOUT_MS = 60_000;

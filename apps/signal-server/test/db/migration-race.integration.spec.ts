import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';

/**
 * Tester (cluster bt-platform): what the existing migration specs do not cover — several servers
 * booting against ONE fresh database at once (T-004: "two servers booting against one DB cannot
 * race", the pg advisory lock), and a tampered, already-applied migration file refusing to boot
 * (postgrator's checksum). A silent race here means half-applied schemas in production; a silent
 * tamper means the schema no longer matches what the code was written against.
 *
 * Needs a Postgres role that can CREATE DATABASE (the local `backtest` role can). Each test makes
 * its own throwaway database next to DATABASE_URL's and drops it. Skipped without DATABASE_URL.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-race.integration.spec.ts: DATABASE_URL not set — skipping the migration race/tamper tests.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

function urlFor(database: string): string {
  const u = new URL(DATABASE_URL as string);
  u.pathname = `/${database}`;
  return u.toString();
}

async function admin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: urlFor('postgres') });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

maybeDescribe('migrations: concurrent boots and tampering (Tester, bt-platform)', () => {
  const made: string[] = [];
  const freshDb = async (): Promise<string> => {
    const name = `bt_mig_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await admin((c) => c.query(`create database ${name}`));
    made.push(name);
    return urlFor(name);
  };
  const versions = async (url: string): Promise<number[]> => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      return (await c.query<{ version: string }>('select version from schema_migrations order by version')).rows.map((r) => Number(r.version));
    } finally {
      await c.end();
    }
  };

  afterAll(async () => {
    for (const name of made) await admin((c) => c.query(`drop database if exists ${name} with (force)`));
  });

  it.each([2, 3, 4])('%i runners at once on a fresh database: exactly one applies all of 001–003, none fails, versions consistent', async (runners) => {
    const url = await freshDb();
    const results = await Promise.allSettled(Array.from({ length: runners }, () => runMigrations({ connectionString: url })));

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const applied = results.map((r) => (r as PromiseFulfilledResult<{ applied: unknown[] }>).value.applied.length);
    expect(applied.filter((n) => n === 3)).toHaveLength(1);
    expect(applied.filter((n) => n === 0)).toHaveLength(runners - 1);
    expect(await versions(url)).toEqual([0, 1, 2, 3]);
  }, 60_000);

  it('an applied migration edited afterwards fails the checksum and applies nothing further', async () => {
    const url = await freshDb();
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-mig-'));
    try {
      for (const f of fs.readdirSync(MIGRATIONS_DIR)) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(copy, f));
      const pattern = `${copy}/*`;
      await runMigrations({ connectionString: url, migrationPattern: pattern, target: '2' });
      expect(await versions(url)).toEqual([0, 1, 2]);

      fs.appendFileSync(path.join(copy, '002.do.widen-r-columns.sql'), '\n-- edited after it was applied\n');
      await expect(runMigrations({ connectionString: url, migrationPattern: pattern })).rejects.toThrow(/checksum/i);
      expect(await versions(url)).toEqual([0, 1, 2]); // 003 was not applied on top of a tampered history
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  }, 30_000);
});

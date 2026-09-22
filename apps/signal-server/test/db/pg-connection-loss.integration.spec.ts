import { Logger } from '@nestjs/common';
import { Client } from 'pg';
import { PgDatabase } from '../../src/db/pg/pg-database';

/**
 * BUG-013 — losing a Postgres connection must not take the server down. Before the fix, an idle
 * pooled client whose backend was terminated (a Postgres restart, pg_terminate_backend, a network
 * drop) was re-emitted as an unhandled 'error' on the pool and the process exited ("Emitted 'error'
 * event on BoundPool instance"). Jest turns an unhandled 'error' into a failed suite, so "the
 * process survives" is these tests completing. Skipped without DATABASE_URL.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

maybeDescribe('PgDatabase survives a lost connection (BUG-013)', () => {
  let db: PgDatabase;
  let admin: Client;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
  });
  afterAll(() => admin.end());

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = new PgDatabase(DATABASE_URL as string);
  });
  afterEach(async () => {
    await db.end();
    warn.mockRestore();
  });

  const backendPid = async (): Promise<number> => (await db.query<{ pid: number }>('select pg_backend_pid() as pid'))[0].pid;
  const terminate = async (pid: number) => {
    const { rows } = await admin.query<{ ok: boolean }>('select pg_terminate_backend($1) as ok', [pid]);
    expect(rows[0].ok).toBe(true);
  };
  /** Until `check` holds (the pool learns of the loss asynchronously), at most `ms`. */
  const until = async (check: () => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    expect(check()).toBe(true);
  };

  it('an idle pooled connection terminated by the server: logged at warn, no crash, the next query reconnects', async () => {
    const first = await backendPid(); // the pool now holds one idle client on this backend
    await terminate(first);
    await until(() => warn.mock.calls.length > 0);

    const line = String(warn.mock.calls[0][0]);
    expect(line).toMatch(/idle Postgres connection lost \(57P01: terminating connection due to administrator command\)/);
    expect(line).not.toContain(DATABASE_URL as string); // never the connection string
    expect(line).not.toMatch(/postgres(ql)?:\/\//);

    const second = await backendPid(); // a fresh connection
    expect(second).not.toBe(first);
    expect(await db.query<{ one: number }>('select 1 as one')).toEqual([{ one: 1 }]);
  });

  it('a connection terminated mid-transaction: the transaction rejects, the client is not reused, the next transaction works', async () => {
    let inside: number | undefined;
    const failed = db.transaction(async (tx) => {
      inside = (await tx.query<{ pid: number }>('select pg_backend_pid() as pid'))[0].pid;
      await terminate(inside);
      await tx.query('select 1'); // on the dead connection
    });
    await expect(failed).rejects.toThrow();

    const after = await db.transaction(async (tx) => (await tx.query<{ pid: number }>('select pg_backend_pid() as pid'))[0].pid);
    expect(after).not.toBe(inside); // the broken client was destroyed, not handed out again
    expect(await db.query<{ one: number }>('select 1 as one')).toEqual([{ one: 1 }]);
  });
});

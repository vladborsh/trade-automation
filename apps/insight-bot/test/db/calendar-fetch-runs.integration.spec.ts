import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { CalendarRepository } from '../../src/collectors/calendar/calendar.repository';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-058 against a real Postgres: migration 019's `calendar_fetch_runs` and the two repository
 * calls "already collected today" is decided from. Skipped without DATABASE_URL.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('calendar-fetch-runs.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

maybeDescribe('IB-058 calendar_fetch_runs against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let repo: CalendarRepository;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_calruns', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    db = new PgDatabase(url.toString());
    await runMigrations({ connectionString: url.toString() });
    repo = new CalendarRepository(db);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await admin.end();
    await dropOwn(async () => {
      const c = new Client({ connectionString: DATABASE_URL });
      await c.connect();
      return c;
    }, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('reads null before the first run', async () => {
    expect(await repo.lastFetchRun()).toBeNull();
  });

  it('reads back the latest day as a UTC date string, whatever the session zone', async () => {
    const at = Date.parse('2026-10-28T23:30:00Z');
    await repo.recordFetchRun({ day: '2026-10-27', fetchedAt: at - 86_400_000, events: 80 });
    await repo.recordFetchRun({ day: '2026-10-28', fetchedAt: at, events: 87 });

    expect(await repo.lastFetchRun()).toEqual({ day: '2026-10-28', fetchedAt: at, events: 87 });
  });

  it('a second run on the same day overwrites rather than failing', async () => {
    const at = Date.parse('2026-10-28T23:45:00Z');
    await repo.recordFetchRun({ day: '2026-10-28', fetchedAt: at, events: 90 });

    expect(await repo.lastFetchRun()).toEqual({ day: '2026-10-28', fetchedAt: at, events: 90 });
    const rows = await db.query<{ n: string }>('select count(*) as n from calendar_fetch_runs');
    expect(Number(rows[0].n)).toBe(2);
  });

  it('gives every member calendar alerts by default, and the dedup journal one row per key', async () => {
    const [user] = await db.query<{ id: number; calendar_alerts: boolean }>(
      `insert into users (tg_user_id, chat_id, role) values (1001, 1001, 'member') returning id, calendar_alerts`,
    );
    expect(user.calendar_alerts).toBe(true);

    await db.query(`insert into calendar_notifications_sent (user_id, key) values ($1, 'due:1')`, [user.id]);
    const again = await db.query(
      `insert into calendar_notifications_sent (user_id, key) values ($1, 'due:1') on conflict do nothing returning key`,
      [user.id],
    );
    expect(again).toEqual([]);
  });
});

import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { CalendarRepository } from '../../src/collectors/calendar/calendar.repository';
import { calendarEvents, lastFetchedAt } from '../../src/web/calendar/pg/calendar.repo';
import { PgCalendarNotifyStore } from '../../src/delivery/pg/calendar-notify.repo';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-058 against a real Postgres: migration 019's `calendar_fetch_runs` and the two repository
 * calls "already collected today" is decided from; and IB-059's dashboard read over
 * `calendar_events`. Skipped without DATABASE_URL.
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

  it('IB-059: the dashboard read keeps the latest revision of high + holiday USD events only', async () => {
    const at = new Date('2026-10-28T08:00:00Z');
    const insert = `insert into calendar_events (id, revision, source, series_id, event_time, currency, title, impact, status, fetched_at)
      values ($1, $2, 'forexfactory', $3, $4, $5, $6, $7, $8, $9)`;
    await db.query(insert, ['ff:1:2026-10-28', 1, '1', new Date('2026-10-28T12:30:00Z'), 'USD', 'CPI', 'high', 'scheduled', at]);
    await db.query(insert, ['ff:1:2026-10-28', 2, '1', new Date('2026-10-28T12:30:00Z'), 'USD', 'CPI m/m', 'high', 'scheduled', at]);
    await db.query(insert, ['ff:2:2026-10-28', 1, '2', new Date('2026-10-28T14:00:00Z'), 'USD', 'Pending Home Sales', 'medium', 'scheduled', at]);
    await db.query(insert, ['ff:3:2026-10-29', 1, '3', new Date('2026-10-29T04:00:00Z'), 'USD', 'Bank Holiday', 'holiday', 'scheduled', at]);
    await db.query(insert, ['ff:4:2026-10-28', 1, '4', new Date('2026-10-28T13:00:00Z'), 'EUR', 'ECB', 'high', 'scheduled', at]);
    await db.query(insert, ['ff:5:2026-10-28', 1, '5', new Date('2026-10-28T15:00:00Z'), 'USD', 'Withdrawn', 'high', 'scheduled', at]);
    await db.query(insert, ['ff:5:2026-10-28', 2, '5', new Date('2026-10-28T15:00:00Z'), 'USD', 'Withdrawn', 'high', 'cancelled', at]);

    const events = await calendarEvents(
      db,
      { fromMs: Date.parse('2026-10-26T00:00:00Z'), toMs: Date.parse('2026-11-02T00:00:00Z') - 1, currency: 'USD', impacts: ['high', 'holiday'] },
      Date.parse('2026-10-29T08:00:00Z'),
    );
    expect(events.map((e) => [e.id, e.revision, e.title, e.impact])).toEqual([
      ['ff:1:2026-10-28', 2, 'CPI m/m', 'high'],
      ['ff:3:2026-10-29', 1, 'Bank Holiday', 'holiday'],
    ]);
    expect(await lastFetchedAt(db)).toBe(Date.parse('2026-10-28T23:45:00Z'));
  });

  it('IB-062: the notifier store — recipients, collected day, claim once, journal by member', async () => {
    const store = new PgCalendarNotifyStore(db);
    // user 1001 exists from the test above (calendar_alerts default true); add one opted out,
    // one disabled and one never started (no chat)
    await db.query(`insert into users (tg_user_id, chat_id, role, calendar_alerts) values (1002, 1002, 'member', false)`);
    await db.query(`insert into users (tg_user_id, chat_id, role, disabled) values (1003, 1003, 'member', true)`);
    await db.query(`insert into users (tg_user_id, role) values (1004, 'member')`);

    const recipients = await store.recipients();
    expect(recipients.map((r) => r.chatId)).toEqual([1001]);
    const id = recipients[0].userId;

    expect(await store.collected('2026-10-28')).toBe(true);
    expect(await store.collected('2026-10-29')).toBe(false);

    const at = Date.parse('2026-10-29T12:15:00Z');
    expect(await store.claim(id, 'due:42', at)).toBe(true);
    expect(await store.claim(id, 'due:42', at)).toBe(false);
    const keys = await store.sentKeys(at - 86_400_000);
    expect([...(keys.get(id) ?? [])].sort()).toEqual(['due:1', 'due:42']);
  });
});

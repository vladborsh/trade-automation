import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { WebCalendarEventsResponseSchema } from '@trade-automation/contracts';
import type { Db } from '../../src/db/db.port';
import type { EventInWindow } from '../../src/collectors/calendar/events-in-window';
import { CalendarController } from '../../src/web/calendar/calendar.controller';

/**
 * IB-059 — the wire shape of `/api/web/calendar/*` is pinned by a committed fixture: the schema
 * must parse it, and the controller, fed the stored rows behind it, must produce exactly it. A
 * change on either side fails here rather than in the dashboard.
 */
const FIXTURE = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'web', 'calendar-events.json'), 'utf8'));
const FETCHED = new Date(FIXTURE.lastFetchedAt);
const NOW = Date.parse('2026-10-29T08:00:00Z');

const ROWS: EventInWindow[] = [
  {
    id: 'ff:832:2026-10-28', revision: 2, series_id: '832', event_time: new Date('2026-10-28T12:30:00Z'),
    currency: 'USD', title: 'Non-Farm Employment Change', impact: 'high', status: 'scheduled',
    forecast: '165K', previous: '142K', actual: '171K', actual_source: 'next-previous', fetched_at: FETCHED,
  },
  {
    id: 'ff:900:2026-11-26', revision: 1, series_id: '900', event_time: new Date('2026-11-26T05:00:00Z'),
    currency: 'USD', title: 'Bank Holiday', impact: 'holiday', status: 'scheduled',
    forecast: null, previous: null, actual: null, actual_source: null, fetched_at: FETCHED,
  },
];

function fakeDb(rows: EventInWindow[] = ROWS, fetchedAt: Date | null = FETCHED) {
  const queries: Array<{ sql: string; params: readonly unknown[] }> = [];
  const db: Db = {
    query: async (sql: string, params: readonly unknown[] = []) => {
      queries.push({ sql, params });
      return (sql.includes('calendar_fetch_runs') ? [{ at: fetchedAt }] : rows) as never;
    },
    transaction: async (fn) => fn(db),
  };
  return { db, queries };
}

describe('CalendarController (IB-059)', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('the committed fixture parses with the contract schema', () => {
    expect(WebCalendarEventsResponseSchema.parse(FIXTURE)).toEqual(FIXTURE);
  });

  it('/events answers exactly the fixture for the rows behind it', async () => {
    const { db } = fakeDb();
    const res = await new CalendarController(db).events(String(Date.UTC(2026, 9, 26)), String(Date.UTC(2026, 11, 1)));
    expect(res).toEqual(FIXTURE);
    expect(WebCalendarEventsResponseSchema.safeParse(res).success).toBe(true);
  });

  it('/events reads USD high + holiday by default, latest revision, scheduled only', async () => {
    const { db, queries } = fakeDb();
    await new CalendarController(db).events(String(Date.UTC(2026, 9, 26)), String(Date.UTC(2026, 10, 2)));
    const events = queries.find((q) => q.sql.includes('calendar_events'));
    expect(events?.sql).toContain('distinct on (id)');
    expect(events?.params).toEqual([
      new Date(Date.UTC(2026, 9, 26)), new Date(Date.UTC(2026, 10, 2) - 1), ['high', 'holiday'], 'USD', 'scheduled',
    ]);
  });

  it('/events refuses 91 days with RANGE_TOO_WIDE and never queries', async () => {
    const { db, queries } = fakeDb();
    const call = new CalendarController(db).events(String(Date.UTC(2026, 0, 1)), String(Date.UTC(2026, 0, 1) + 91 * 86_400_000));
    await expect(call).rejects.toThrow(HttpException);
    await call.catch((e: HttpException) => {
      expect(e.getStatus()).toBe(400);
      expect(e.getResponse()).toMatchObject({ code: 'RANGE_TOO_WIDE', maxDays: 90 });
    });
    expect(queries).toEqual([]);
  });

  it('/upcoming reads high-impact USD from 5 minutes ago to withinMin ahead', async () => {
    const { db, queries } = fakeDb([]);
    const res = await new CalendarController(db).upcoming('30');
    expect(res).toEqual({ events: [], lastFetchedAt: FIXTURE.lastFetchedAt });
    const events = queries.find((q) => q.sql.includes('calendar_events'));
    expect(events?.params).toEqual([new Date(NOW - 5 * 60_000), new Date(NOW + 30 * 60_000), ['high'], 'USD', 'scheduled']);
  });

  it('lastFetchedAt is null before the first fetch', async () => {
    const { db } = fakeDb([], null);
    expect((await new CalendarController(db).upcoming()).lastFetchedAt).toBeNull();
  });
});

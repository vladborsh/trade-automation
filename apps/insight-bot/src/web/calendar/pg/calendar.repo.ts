import type { EconomicEvent } from '@trade-automation/contracts';
import type { Db } from '../../../db/db.port';
import { economicEventFromRow } from '../../../collectors/calendar/calendar-row';
import { buildEventsInWindow, type EventInWindow } from '../../../collectors/calendar/events-in-window';
import type { CalendarWindow } from '../calendar-query';

/**
 * IB-059 — the dashboard's calendar reads. The event query is the collector's own
 * `buildEventsInWindow` (latest revision per id, `status = 'scheduled'` on it), so the chart and
 * the veto cannot disagree about which revision of an event is current.
 */
export async function calendarEvents(db: Db, window: CalendarWindow, now: number): Promise<EconomicEvent[]> {
  const { sql, params } = buildEventsInWindow({
    from: new Date(window.fromMs),
    to: new Date(window.toMs),
    currency: window.currency,
    impacts: window.impacts,
  });
  const rows = await db.query<EventInWindow>(sql, params);
  return rows.map((row) => economicEventFromRow(row, now));
}

/** Epoch ms of the last successful fetch (IB-058's `calendar_fetch_runs`), or null. */
export async function lastFetchedAt(db: Db): Promise<number | null> {
  const rows = await db.query<{ at: Date | null }>('select max(fetched_at) as at from calendar_fetch_runs');
  return rows[0]?.at ? rows[0].at.getTime() : null;
}

import { EconomicEvent, eventDayNY } from '@trade-automation/contracts';
import { EventInWindow } from './events-in-window';
import { CalendarEventRow, CalendarEventStatus } from '../writers/tables';

/**
 * architecture/insight-bot-system-design.md §3.3, §16.7 — the pure projection of the
 * `EconomicEvent` the lifted ForexFactory logic produces onto one `calendar_events` row.
 *
 * Two field names differ from the event and both are deliberate:
 *
 * - **`currency` ← `event.country`.** ForexFactory's `country` field already *is* a currency code
 *   (`USD`, `EUR`, or the literal `All`) — see `EventCountrySchema` in contracts — so the column
 *   the §9.3 veto filters on (`currency = 'USD'`) is fed straight from it. Only the name differs.
 * - **`status`.** The event's own status is `scheduled | released | removed`; the column's
 *   vocabulary is `scheduled | cancelled | rescheduled`. `released` maps to **`scheduled`**, not to
 *   a third value: §9.3's window is ±60 minutes, so for a full hour *after* it fires an event is
 *   still the veto's business, and a released event that stopped matching `status = 'scheduled'`
 *   would silently switch the veto off exactly when it matters most. `removed` maps to
 *   `cancelled`.
 *
 * `rescheduled` is never written from this feed, and that is a property of the feed rather than an
 * omission: ForexFactory expresses a move as a *new* id (the id carries the ET day) plus the
 * disappearance of the old one, which the diff sees as a creation and a removal with nothing
 * linking them. The value stays in the vocabulary for a later source that can tell the two apart.
 */
export function calendarEventRow(event: EconomicEvent, fetchedAt: number): CalendarEventRow {
  return {
    id: event.id,
    revision: event.revision,
    source: event.source,
    seriesId: event.seriesId,
    eventTime: new Date(event.scheduledAt),
    currency: event.country,
    title: event.title,
    impact: event.impact,
    status: statusOf(event),
    forecast: event.forecast,
    previous: event.previous,
    actual: event.actual,
    actualSource: event.actualSource,
    fetchedAt: new Date(fetchedAt),
  };
}

function statusOf(event: EconomicEvent): CalendarEventStatus {
  return event.status === 'removed' ? 'cancelled' : 'scheduled';
}

/**
 * The reverse projection: a stored row back into the `EconomicEvent` the lifted `diffSnapshot`
 * compares against. Only the six diffed fields (`title`, `country`, `impact`, `scheduledAt`,
 * `forecast`, `previous`) plus `actual`/`actualSource`/`revision` have to survive the round trip,
 * and all of them are columns. `sourceUrl` is not stored (it is a display link, never diffed) and
 * comes back `null`; `firstSeenAt`/`lastSeenAt` collapse onto `fetched_at`, which is what the row
 * records.
 *
 * `status` is un-projected the way it was projected: `cancelled` → `removed`, anything else →
 * `released` or `scheduled` by the event's own time, which is how signal-server's diff would have
 * created it.
 */
export function economicEventFromRow(row: EventInWindow, now: number): EconomicEvent {
  const scheduledAt = row.event_time.getTime();
  const fetchedAt = row.fetched_at.getTime();
  return {
    id: row.id,
    source: 'forexfactory',
    seriesId: row.series_id,
    sourceUrl: null,
    title: row.title ?? '',
    country: row.currency ?? 'All',
    impact: (row.impact ?? 'unknown') as EconomicEvent['impact'],
    scheduledAt,
    scheduledDay: eventDayNY(scheduledAt),
    forecast: row.forecast,
    previous: row.previous,
    actual: row.actual,
    actualSource: row.actual_source as EconomicEvent['actualSource'],
    actualAt: row.actual !== null ? fetchedAt : null,
    status: row.status === 'cancelled' ? 'removed' : scheduledAt <= now ? 'released' : 'scheduled',
    firstSeenAt: fetchedAt,
    lastSeenAt: fetchedAt,
    revision: row.revision,
  };
}

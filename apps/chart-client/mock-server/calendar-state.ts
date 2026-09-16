import { CALENDAR_FIXTURE_TEMPLATE } from './calendar-fixture';
import { etDayString, startOfThisWeekEtUtcMs } from './et-time';
import type { CalendarNotification, EconomicEvent, EventRevision } from './calendar-types';

export type CalendarEventListener = (event: EconomicEvent, change: 'created' | 'updated' | 'removed' | 'actual') => void;
export type CalendarNotificationListener = (notification: CalendarNotification) => void;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Default cadence for the dev/manual-testing experience ("every few minutes", §7.2); overridable for e2e speed. */
const DEFAULT_NOTIFICATION_INTERVAL_MS = 180_000;
const DEFAULT_NOTIFICATION_FIRST_DELAY_MS = 20_000;

/**
 * §7.2 — stands in for SE-CAL-1's real `calendar` module entirely: serves
 * `GET /api/calendar/*` from the committed fixture (re-dated to this week
 * at startup so the "now" line lands mid-week) and emits a synthetic
 * `notification` frame on an interval, so SE-CAL-2 builds and e2e-tests
 * without the real server unit (the SE-2/SE-5 precedent).
 */
export class MockCalendarState {
  private readonly eventsById = new Map<string, EconomicEvent>();
  private readonly revisionsByEventId = new Map<string, EventRevision[]>();
  private readonly notifications: CalendarNotification[] = [];
  private readonly eventListeners = new Set<CalendarEventListener>();
  private readonly notificationListeners = new Set<CalendarNotificationListener>();
  readonly weekFrom: number;
  readonly weekTo: number;
  readonly weekDays: string[];

  constructor(
    now = Date.now(),
    private readonly notificationIntervalMs = DEFAULT_NOTIFICATION_INTERVAL_MS,
    private readonly notificationFirstDelayMs = DEFAULT_NOTIFICATION_FIRST_DELAY_MS,
  ) {
    this.weekFrom = startOfThisWeekEtUtcMs(now);
    this.weekTo = this.weekFrom + WEEK_MS;
    this.weekDays = Array.from({ length: 7 }, (_, i) => etDayString(this.weekFrom + i * DAY_MS + 12 * 60 * 60 * 1000));

    for (const template of CALENDAR_FIXTURE_TEMPLATE) {
      const scheduledAt = this.weekFrom + template.dayOffset * DAY_MS + template.hour * 60 * 60 * 1000 + template.minute * 60 * 1000;
      const id = `ff:${template.seriesId}:${etDayString(scheduledAt)}`;
      const event: EconomicEvent = {
        id,
        source: 'forexfactory',
        seriesId: template.seriesId,
        sourceUrl: `https://www.forexfactory.com/calendar/${template.seriesId}`,
        title: template.title,
        country: template.country,
        impact: template.impact,
        scheduledAt,
        scheduledDay: etDayString(scheduledAt),
        forecast: template.forecast,
        previous: template.previous,
        actual: null,
        actualSource: null,
        actualAt: null,
        status: scheduledAt <= now ? 'released' : 'scheduled',
        firstSeenAt: now,
        lastSeenAt: now,
        revision: 1,
      };
      this.eventsById.set(id, event);
      this.revisionsByEventId.set(id, [
        { eventId: id, revision: 1, at: now, change: 'created', before: null, after: { ...event } },
      ]);
    }
  }

  start(): void {
    setTimeout(() => {
      this.emitSyntheticNotification();
      setInterval(() => this.emitSyntheticNotification(), this.notificationIntervalMs);
    }, this.notificationFirstDelayMs);
  }

  onCalendarEvent(listener: CalendarEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onNotification(listener: CalendarNotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  weekResponse(at?: number): { from: number; to: number; day: string[]; events: EconomicEvent[] } {
    if (at === undefined) {
      return { from: this.weekFrom, to: this.weekTo, day: this.weekDays, events: this.eventsInRange(this.weekFrom, this.weekTo) };
    }
    const from = startOfThisWeekEtUtcMs(at);
    const to = from + WEEK_MS;
    const day = Array.from({ length: 7 }, (_, i) => etDayString(from + i * DAY_MS + 12 * 60 * 60 * 1000));
    // Only the fixture's own committed week has data; other weeks are legitimately empty (matches
    // the real feed's D7 "only this week is ever visible" behaviour for anything not backfilled).
    return { from, to, day, events: this.eventsInRange(from, to) };
  }

  eventsInRange(from: number, to: number): EconomicEvent[] {
    return [...this.eventsById.values()]
      .filter((e) => e.scheduledAt >= from && e.scheduledAt < to)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  eventDetail(id: string): { event: EconomicEvent; revisions: EventRevision[] } | null {
    const event = this.eventsById.get(id);
    if (!event) {
      return null;
    }
    return { event, revisions: this.revisionsByEventId.get(id) ?? [] };
  }

  notificationsSince(from: number, limit: number): CalendarNotification[] {
    return this.notifications
      .filter((n) => n.at >= from)
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  }

  private emitSyntheticNotification(): void {
    const now = Date.now();
    const candidates = [...this.eventsById.values()]
      .filter((e) => e.status !== 'removed')
      .sort((a, b) => Math.abs(a.scheduledAt - now) - Math.abs(b.scheduledAt - now));
    const event = candidates[0];
    if (!event) {
      return;
    }
    const notification: CalendarNotification = {
      id: `due:${now}`,
      kind: 'event-due',
      at: now,
      events: [event],
      title: `${event.country} · ${event.impact} · ${event.title}`,
    };
    this.notifications.unshift(notification);
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
  }
}

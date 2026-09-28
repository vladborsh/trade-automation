import { CalendarNotification, EconomicEvent } from '@trade-automation/contracts';
import { CalendarEventChange } from '@trade-automation/calendar-core';

/** architecture/economic-calendar.md §3, §6.2 — event names on @nestjs/event-emitter's in-process bus. */
export const CalendarEvents = {
  EventChanged: 'calendar.event.changed',
  NotificationFired: 'calendar.notification.fired',
} as const;

/** IB-010: the union lives in calendar-core with the diff; re-exported so existing imports are unchanged. */
export type { CalendarEventChange };

export class CalendarEventChangedEvent {
  constructor(
    public readonly event: EconomicEvent,
    public readonly change: CalendarEventChange,
  ) {}
}

export class CalendarNotificationFiredEvent {
  constructor(public readonly notification: CalendarNotification) {}
}

import { CalendarNotification, EconomicEvent } from '@trade-automation/contracts';

/** architecture/economic-calendar.md §3, §6.2 — event names on @nestjs/event-emitter's in-process bus. */
export const CalendarEvents = {
  EventChanged: 'calendar.event.changed',
  NotificationFired: 'calendar.notification.fired',
} as const;

export type CalendarEventChange = 'created' | 'updated' | 'removed' | 'actual';

export class CalendarEventChangedEvent {
  constructor(
    public readonly event: EconomicEvent,
    public readonly change: CalendarEventChange,
  ) {}
}

export class CalendarNotificationFiredEvent {
  constructor(public readonly notification: CalendarNotification) {}
}

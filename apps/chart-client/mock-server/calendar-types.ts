/** Mirrors src/app/core/contracts/calendar.ts — see that file's header for why this isn't a shared import. */

export type EventImpact = 'low' | 'medium' | 'high' | 'holiday' | 'unknown';
export type EventStatus = 'scheduled' | 'released' | 'removed';

export interface EconomicEvent {
  id: string;
  source: 'forexfactory';
  seriesId: string | null;
  sourceUrl: string | null;
  title: string;
  country: string;
  impact: EventImpact;
  scheduledAt: number;
  scheduledDay: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  actualSource: 'feed' | 'next-previous' | 'provider' | null;
  actualAt: number | null;
  status: EventStatus;
  firstSeenAt: number;
  lastSeenAt: number;
  revision: number;
}

export interface EventRevision {
  eventId: string;
  revision: number;
  at: number;
  change: 'created' | 'updated' | 'removed' | 'actual';
  before: Partial<EconomicEvent> | null;
  after: Partial<EconomicEvent>;
}

export type CalendarNotificationKind = 'daily-digest' | 'event-due';

export interface CalendarNotification {
  id: string;
  kind: CalendarNotificationKind;
  at: number;
  day?: string;
  events: EconomicEvent[];
  title: string;
}

export interface CalendarWeekResponse {
  from: number;
  to: number;
  day: string[];
  events: EconomicEvent[];
}

export type CalendarServerFrame =
  | { type: 'calendarEvent'; event: EconomicEvent; change: 'created' | 'updated' | 'removed' | 'actual' }
  | { type: 'notification'; notification: CalendarNotification };

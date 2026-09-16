/**
 * architecture/economic-calendar.md §2.1, §6 — client-local shape of the
 * calendar contract. SE-CAL-2 builds independently of SE-CAL-1 (§10), so
 * these are duck-typed against the note rather than imported from
 * `@trade-automation/contracts` (that package's `calendar.ts` is SE-CAL-1's
 * own deliverable, built in parallel). Whoever integrates the two units
 * later can re-point these imports at the shared package — the shapes are
 * written to match §2.1 field-for-field so that swap is mechanical.
 */

export type EventImpact = 'low' | 'medium' | 'high' | 'holiday' | 'unknown';
export type EventStatus = 'scheduled' | 'released' | 'removed';
export type ActualSource = 'feed' | 'next-previous' | 'provider';

export interface EconomicEvent {
  id: string;
  source: 'forexfactory';
  seriesId: string | null;
  sourceUrl: string | null;
  title: string;
  country: string; // ISO currency code, or the literal 'All'
  impact: EventImpact;
  scheduledAt: number; // ms UTC
  scheduledDay: string; // 'YYYY-MM-DD', the ET calendar day
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  actualSource: ActualSource | null;
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
  at: number; // ms UTC
  day?: string;
  events: EconomicEvent[];
  title: string;
}

export interface CalendarWeekResponse {
  from: number;
  to: number;
  day: string[]; // the seven scheduledDay strings, Sun..Sat
  events: EconomicEvent[];
}

export interface EventDetailResponse {
  event: EconomicEvent;
  revisions: EventRevision[];
}

/** §6.2 — the two calendar frames added to the WS server→client union. */
export interface WsCalendarEventFrame {
  type: 'calendarEvent';
  event: EconomicEvent;
  change: 'created' | 'updated' | 'removed' | 'actual';
}

export interface WsNotificationFrame {
  type: 'notification';
  notification: CalendarNotification;
}

export type CalendarServerFrame = WsCalendarEventFrame | WsNotificationFrame;

/** §6.2 — the one calendar topic, no parameters. */
export interface CalendarSubscribeFrame {
  type: 'subscribe';
  topic: 'calendar';
}

export interface CalendarUnsubscribeFrame {
  type: 'unsubscribe';
  topic: 'calendar';
}

export type CalendarClientFrame = CalendarSubscribeFrame | CalendarUnsubscribeFrame;

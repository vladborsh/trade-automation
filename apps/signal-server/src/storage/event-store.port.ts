import { CalendarNotification, EconomicEvent, EventRevision } from '@trade-automation/contracts';

/** architecture/economic-calendar.md §4.2. */
export interface EventStore {
  /** Idempotent on id. */
  upsert(events: EconomicEvent[]): Promise<void>;
  /** Ascending by scheduledAt; all statuses. */
  queryByScheduled(from: number, to: number): Promise<EconomicEvent[]>;
  get(id: string): Promise<EconomicEvent | null>;
  appendRevisions(rows: EventRevision[]): Promise<void>;
  /** Ascending by revision. */
  queryRevisions(eventId: string): Promise<EventRevision[]>;
  appendNotifications(rows: CalendarNotification[]): Promise<void>;
  queryNotifications(from: number, to: number): Promise<CalendarNotification[]>;
}
export const EVENT_STORE = Symbol('EVENT_STORE');

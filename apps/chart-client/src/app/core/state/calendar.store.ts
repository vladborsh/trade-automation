import { Injectable, computed, signal } from '@angular/core';
import type { CalendarWeekResponse, EconomicEvent } from '../contracts/calendar';

/**
 * §7 `calendar.store.ts` — merge rule: same id replaces the stored event
 * only if the incoming revision is greater-or-equal (§2.2's `revision`
 * bumps on every server-side change; a stale WS frame arriving after a
 * newer week-fetch must never regress the row).
 */
export function mergeEvent(events: ReadonlyMap<string, EconomicEvent>, incoming: EconomicEvent): Map<string, EconomicEvent> {
  const existing = events.get(incoming.id);
  if (existing && existing.revision > incoming.revision) {
    return new Map(events);
  }
  const next = new Map(events);
  next.set(incoming.id, incoming);
  return next;
}

export interface CalendarWeekWindow {
  from: number;
  to: number;
  days: string[]; // scheduledDay strings, Sun..Sat
}

@Injectable({ providedIn: 'root' })
export class CalendarStore {
  private readonly eventsMap = signal<Map<string, EconomicEvent>>(new Map());
  private readonly weekWindow = signal<CalendarWeekWindow | null>(null);
  private readonly highlighted = signal<string | null>(null);

  readonly window = this.weekWindow.asReadonly();
  /** Set when a toast is clicked (§7 toast-host) so the calendar view can scroll to and highlight the row. */
  readonly highlightedEventId = this.highlighted.asReadonly();

  readonly events = computed<EconomicEvent[]>(() =>
    [...this.eventsMap().values()].sort((a, b) => a.scheduledAt - b.scheduledAt),
  );

  /** Grouped by `scheduledDay` (ET) — the columns the calendar table renders (§7.1). */
  readonly eventsByDay = computed<Map<string, EconomicEvent[]>>(() => {
    const grouped = new Map<string, EconomicEvent[]>();
    for (const event of this.events()) {
      const bucket = grouped.get(event.scheduledDay) ?? [];
      bucket.push(event);
      grouped.set(event.scheduledDay, bucket);
    }
    return grouped;
  });

  setWeek(response: CalendarWeekResponse): void {
    const next = new Map<string, EconomicEvent>();
    for (const event of response.events) {
      next.set(event.id, event);
    }
    this.eventsMap.set(next);
    this.weekWindow.set({ from: response.from, to: response.to, days: response.day });
  }

  mergeLive(event: EconomicEvent): void {
    this.eventsMap.update((current) => mergeEvent(current, event));
  }

  get(id: string): EconomicEvent | undefined {
    return this.eventsMap().get(id);
  }

  highlight(id: string): void {
    this.highlighted.set(id);
  }

  clearHighlight(): void {
    this.highlighted.set(null);
  }
}

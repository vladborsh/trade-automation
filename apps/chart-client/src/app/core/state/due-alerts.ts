import type { EconomicEvent } from '../contracts/calendar';
import { passesFilters, type CalendarFilters } from './calendar-filters.store';

/**
 * architecture/economic-calendar.md §11.5 — which pre-event alerts are due
 * now. Pure: the service owns time, storage and sound.
 *
 * - events passing the calendar filters with `status === 'scheduled'`;
 * - grouped by `scheduledAt` (FOMC's three 14:00 rows ring once);
 * - due while `now ∈ [scheduledAt − lead, scheduledAt + LATE_GRACE_MS]`,
 *   silently dropped after that (an alert after the event is noise);
 * - keyed `alert:<scheduledAt>` only: one instant rings at most once, whichever
 *   of its events pass the filters (changing filters inside the lead window
 *   must not re-ring); a time revision changes `scheduledAt`, so a moved
 *   event is a new key and rings again at its new time.
 */
export const LATE_GRACE_MS = 60_000;
export const FIRED_RETENTION_MS = 48 * 60 * 60 * 1000;

export interface DueAlert {
  key: string;
  scheduledAt: number;
  events: EconomicEvent[];
}

export function alertKey(scheduledAt: number): string {
  return `alert:${scheduledAt}`;
}

export function dueAlerts(
  events: Iterable<EconomicEvent>,
  filters: CalendarFilters,
  leadMs: number,
  now: number,
  fired: ReadonlySet<string>,
): DueAlert[] {
  const groups = new Map<number, EconomicEvent[]>();
  for (const event of events) {
    if (event.status !== 'scheduled' || !passesFilters(event, filters)) {
      continue;
    }
    if (now < event.scheduledAt - leadMs || now > event.scheduledAt + LATE_GRACE_MS) {
      continue;
    }
    const group = groups.get(event.scheduledAt) ?? [];
    group.push(event);
    groups.set(event.scheduledAt, group);
  }
  const due: DueAlert[] = [];
  for (const [scheduledAt, group] of [...groups].sort(([a], [b]) => a - b)) {
    const key = alertKey(scheduledAt);
    if (!fired.has(key)) {
      due.push({ key, scheduledAt, events: group });
    }
  }
  return due;
}

/** Fired ledger `{ key: firedAt }`, keeping only the last 48 h. */
export function pruneFired(ledger: Readonly<Record<string, number>>, now: number): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [key, at] of Object.entries(ledger)) {
    if (typeof at === 'number' && now - at <= FIRED_RETENTION_MS) {
      kept[key] = at;
    }
  }
  return kept;
}

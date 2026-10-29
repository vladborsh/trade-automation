import type { EconomicEvent } from '@trade-automation/contracts';

/**
 * architecture/economic-calendar.md §11.5 — which pre-event alerts are due
 * now. Pure: the service owns time, storage and sound.
 *
 * Moved from the backtest SPA (`apps/chart-client/src/app/core/state/`) by IB-061 so the insight
 * dashboard's browser alerts use the same rule; the SPA's filter test is now the `passes`
 * parameter, since filters are that app's own concern. Browsers import it as
 * `@trade-automation/calendar-core/due-alerts`: the package root also carries the feed client,
 * which needs Node (`crypto`, `Buffer`).
 *
 * - events passing `passes` with `status === 'scheduled'`;
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

/** The fields the rule reads; generic so each app gets its own event type back. */
export type DueAlertEvent = Pick<EconomicEvent, 'status' | 'scheduledAt'>;

export interface DueAlert<E extends DueAlertEvent = EconomicEvent> {
  key: string;
  scheduledAt: number;
  events: E[];
}

export function alertKey(scheduledAt: number): string {
  return `alert:${scheduledAt}`;
}

export function dueAlerts<E extends DueAlertEvent>(
  events: Iterable<E>,
  passes: (event: E) => boolean,
  leadMs: number,
  now: number,
  fired: ReadonlySet<string>,
): DueAlert<E>[] {
  const groups = new Map<number, E[]>();
  for (const event of events) {
    if (event.status !== 'scheduled' || !passes(event)) {
      continue;
    }
    if (now < event.scheduledAt - leadMs || now > event.scheduledAt + LATE_GRACE_MS) {
      continue;
    }
    const group = groups.get(event.scheduledAt) ?? [];
    group.push(event);
    groups.set(event.scheduledAt, group);
  }
  const due: DueAlert<E>[] = [];
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

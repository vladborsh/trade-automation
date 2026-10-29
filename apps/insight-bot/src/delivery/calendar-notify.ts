import { eventDayNY, type EconomicEvent } from '@trade-automation/contracts';

/**
 * IB-062 — which calendar notifications are due for one member, as a pure function. The service
 * owns the clock, the database and Telegram; this owns the rules:
 *
 * - **Digest**, once per UTC day, key `digest:YYYY-MM-DD`: from `digestAtMin` (minutes after
 *   00:00 UTC, default 07:00) and only once today's fetch has succeeded, so it never goes out on
 *   yesterday's picture. It lists the day's high-impact USD events and any USD holiday. A day
 *   with neither sends nothing — a daily "nothing today" would teach members to ignore it.
 *   It stays sendable for `DIGEST_LATE_MS` after its time (a restart at 09:00 still sends it),
 *   not all day: an evening digest of a morning's events is noise.
 * - **Reminder**, key `due:<scheduledAt ms>`: `leadMs` before a high-impact USD event, events
 *   sharing an instant grouped into one message (FOMC's three 14:00 rows ring once). Sent only
 *   while `now` is within `REMIND_LATE_MS` of the reminder time — a bot that was down through it
 *   stays quiet rather than warning about something already happening.
 *
 * `sentKeys` is what the journal (`calendar_notifications_sent`) holds for this member; it is
 * also what stops a restart repeating anything.
 */
export const REMIND_LATE_MS = 5 * 60_000;
export const DIGEST_LATE_MS = 6 * 60 * 60_000;
const DAY_MS = 86_400_000;

export type DueNotification =
  | { kind: 'digest'; key: string; day: string; events: EconomicEvent[]; holidays: EconomicEvent[] }
  | { kind: 'due'; key: string; scheduledAt: number; events: EconomicEvent[] };

export interface SelectDueInput {
  /** Latest revision of each USD event (high and holiday) around today; others are ignored. */
  events: readonly EconomicEvent[];
  /** True once `calendar_fetch_runs` has a row for today's UTC date. */
  collectedToday: boolean;
  digestAtMin: number;
  leadMs: number;
}

export function digestKey(day: string): string {
  return `digest:${day}`;
}

export function dueKey(scheduledAt: number): string {
  return `due:${scheduledAt}`;
}

const isUsd = (e: EconomicEvent) => e.country === 'USD' && e.status !== 'removed';

export function selectDue(now: number, input: SelectDueInput, sentKeys: ReadonlySet<string>): DueNotification[] {
  const out: DueNotification[] = [];

  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const day = new Date(dayStart).toISOString().slice(0, 10);
  const digestAt = dayStart + input.digestAtMin * 60_000;
  if (input.collectedToday && now >= digestAt && now <= digestAt + DIGEST_LATE_MS && !sentKeys.has(digestKey(day))) {
    const events = input.events
      .filter((e) => isUsd(e) && e.impact === 'high' && e.scheduledAt >= dayStart && e.scheduledAt < dayStart + DAY_MS)
      .sort((a, b) => a.scheduledAt - b.scheduledAt || a.title.localeCompare(b.title));
    // a holiday is an ET day (the feed stamps it at ET midnight); it belongs to the UTC date of the same name
    const holidays = input.events.filter((e) => isUsd(e) && e.impact === 'holiday' && eventDayNY(e.scheduledAt) === day);
    if (events.length > 0 || holidays.length > 0) out.push({ kind: 'digest', key: digestKey(day), day, events, holidays });
  }

  const groups = new Map<number, EconomicEvent[]>();
  for (const e of input.events) {
    if (!isUsd(e) || e.impact !== 'high') continue;
    const remindAt = e.scheduledAt - input.leadMs;
    if (now < remindAt || now > remindAt + REMIND_LATE_MS) continue;
    groups.set(e.scheduledAt, [...(groups.get(e.scheduledAt) ?? []), e]);
  }
  for (const [scheduledAt, events] of [...groups].sort(([a], [b]) => a - b)) {
    if (sentKeys.has(dueKey(scheduledAt))) continue;
    out.push({ kind: 'due', key: dueKey(scheduledAt), scheduledAt, events: events.sort((a, b) => a.title.localeCompare(b.title)) });
  }
  return out;
}

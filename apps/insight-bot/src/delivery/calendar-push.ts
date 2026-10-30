import { alertKey } from '@trade-automation/calendar-core';
import type { WebPushPayload } from '@trade-automation/contracts';
import type { Lang } from '../users/user.model';
import type { DueNotification } from './calendar-notify';
import { calendarReminder, pick } from './templates/texts';

/**
 * IB-069 — the browser push's pure half. Which events: exactly the Telegram reminder's
 * (`selectDue`, high-impact USD, `leadMs` before), and only the reminder — the morning digest
 * stays a Telegram message; a system notification is for "something happens in 15 minutes".
 *
 * The journal key is the Telegram one (`due:<ms>`), recorded per subscription. The notification
 * `tag` is the dashboard's in-tab key (`alert:<ms>`, calendar-core's `alertKey`): an open tab
 * and the push for the same event replace each other in the tray rather than ringing twice.
 */
export type DueReminder = Extract<DueNotification, { kind: 'due' }>;

export function pushReminders(due: readonly DueNotification[]): DueReminder[] {
  return due.filter((d): d is DueReminder => d.kind === 'due');
}

/** Title is the reminder's first line ("Через 13 мин, 12:30 UTC / 14:30 Kyiv — важное по USD"), body its events. */
export function pushPayload(due: DueReminder, now: number, lang: Lang): WebPushPayload {
  const minutes = Math.max(0, Math.round((due.scheduledAt - now) / 60_000));
  const [head, ...lines] = pick(calendarReminder(due.scheduledAt, due.events, minutes), lang).split('\n');
  return { title: head.replace(/:$/, ''), body: lines.join('\n'), tag: alertKey(due.scheduledAt) };
}

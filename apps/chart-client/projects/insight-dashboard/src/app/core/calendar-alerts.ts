import { timeOfDay, zoneLabel, type Zone } from '../shared/time-format';
import type { EconomicEvent } from '@trade-automation/contracts';
import type { DueAlert } from '@trade-automation/calendar-core/due-alerts';

/**
 * IB-061 — the browser alerts' pure half: which events ring, what the notification says, and the
 * two things remembered in `localStorage` (the opt-in and the keys already shown). The service
 * owns the timer, the API and `Notification`; the rule itself is the backtest SPA's `dueAlerts`,
 * shared through `@trade-automation/calendar-core`.
 *
 * Storage is passed in, never reached for, so a spec can hand in one that throws — which is what
 * a private window or blocked site data does. Every read falls back to "off / nothing shown".
 */

/** Minutes before the event the notification appears, as in the Telegram reminder (IB-062). */
export const ALERT_LEAD_MS = 15 * 60_000;
export const OPT_IN_KEY = 'insight.calendarAlerts.on';
export const FIRED_KEY = 'insight.calendarAlerts.fired';

export interface AlertStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage`, or null where touching it throws. */
export function browserAlertStore(): AlertStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** What rings: high-impact USD. The server already filters; this keeps the rule stated here too. */
export function isAlertEvent(e: EconomicEvent): boolean {
  return e.country === 'USD' && e.impact === 'high';
}

export function readOptIn(store: AlertStore | null): boolean {
  try {
    return store?.getItem(OPT_IN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeOptIn(store: AlertStore | null, on: boolean): void {
  try {
    store?.setItem(OPT_IN_KEY, on ? '1' : '0');
  } catch {
    // blocked storage: the choice lasts for this page only
  }
}

/** The fired ledger `{ key: firedAt }`; anything unreadable is an empty ledger. */
export function readFired(store: AlertStore | null): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(FIRED_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function writeFired(store: AlertStore | null, ledger: Record<string, number>): void {
  try {
    store?.setItem(FIRED_KEY, JSON.stringify(ledger));
  } catch {
    // blocked storage: a reload may show an alert again, which is the lesser failure
  }
}

/** Title and body of one notification; `t` fills the translated title. */
export function notificationFor(
  alert: DueAlert<EconomicEvent>,
  now: number,
  title: (minutes: number, time: string) => string,
  zone?: Zone,
): { title: string; body: string } {
  const minutes = Math.max(0, Math.round((alert.scheduledAt - now) / 60_000));
  return {
    title: title(minutes, `${timeOfDay(alert.scheduledAt / 1000, zone)} ${zoneLabel(alert.scheduledAt / 1000, zone)}`),
    body: alert.events.map((e) => e.title).join('\n'),
  };
}

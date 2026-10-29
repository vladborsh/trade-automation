import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';
import { dueAlerts, pruneFired } from '@trade-automation/calendar-core/due-alerts';
import { I18nService } from '../i18n/i18n.service';
import {
  ALERT_LEAD_MS, browserAlertStore, isAlertEvent, notificationFor, readFired, readOptIn, writeFired,
  writeOptIn,
} from './calendar-alerts';
import { InsightApiClient } from './insight-api.client';

/** How often the upcoming events are read; one cheap DB read per minute per open tab. */
export const ALERTS_POLL_MS = 60_000;
const UPCOMING_WITHIN_MIN = 60;

export type AlertPermission = NotificationPermission | 'unsupported';

/**
 * IB-061 — a browser notification 15 minutes before each high-impact USD event, app-wide.
 *
 * **Only while a dashboard tab is open.** There is no service worker and no web push, so a closed
 * tab hears nothing; the toggle's hint says so. The Telegram reminder (IB-062) is the channel that
 * works with the browser shut.
 *
 * Polls `/api/web/calendar/upcoming` once a minute while switched on and permitted. Shown keys go
 * to `localStorage`, so a reload inside the lead window does not ring the same event twice.
 */
@Injectable({ providedIn: 'root' })
export class CalendarAlertsService {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  private readonly store = browserAlertStore();
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly optedIn = signal(readOptIn(this.store));
  readonly permission = signal<AlertPermission>(currentPermission());
  /** On only when the member chose it AND the browser allows it. */
  readonly active = computed(() => this.optedIn() && this.permission() === 'granted');

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(Date.now()), ALERTS_POLL_MS);
    void this.check(Date.now());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The header switch: turning on asks the browser first, and stays off if it says no. */
  async toggle(): Promise<void> {
    if (this.active()) {
      this.set(false);
      return;
    }
    if (this.permission() === 'unsupported') return;
    const answer = this.permission() === 'granted' ? 'granted' : await Notification.requestPermission();
    this.permission.set(answer);
    this.set(answer === 'granted');
    if (answer === 'granted') await this.check(Date.now());
  }

  /** One poll: read the next hour, show whatever is due and not yet shown. Never throws. */
  async check(now: number): Promise<string[]> {
    if (!this.active() || this.document.location.pathname === '/login') return [];
    try {
      const { events } = await this.api.calendarUpcoming(UPCOMING_WITHIN_MIN);
      const fired = pruneFired(readFired(this.store), now);
      const due = dueAlerts(events, isAlertEvent, ALERT_LEAD_MS, now, new Set(Object.keys(fired)));
      for (const alert of due) {
        const { title, body } = notificationFor(alert, now, (minutes, time) =>
          this.i18n.t('alerts.notification.title', { minutes, time }));
        new Notification(title, { tag: alert.key, body });
        fired[alert.key] = now;
      }
      writeFired(this.store, fired);
      return due.map((a) => a.key);
    } catch {
      return []; // offline or signed out: the next minute tries again
    }
  }

  private set(on: boolean): void {
    this.optedIn.set(on);
    writeOptIn(this.store, on);
  }
}

function currentPermission(): AlertPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

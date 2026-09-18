import { Injectable, computed, signal } from '@angular/core';
import type { CalendarNotification, EconomicEvent } from '../contracts/calendar';
import { passesFilters, type CalendarFilters } from './calendar-filters.store';
import { eventGroupLabel } from './calendar-labels';

const MAX_CENTER_ITEMS = 50;
const DESKTOP_OPT_IN_KEY = 'chart-client:desktop-notifications';

export interface Toast {
  toastId: string; // distinct from CalendarNotification.id in case the same notification is re-shown
  notification: CalendarNotification;
  sticky: boolean; // §5.1: digest is sticky until dismissed, event-due auto-dismisses
  /** What the toast shows — built from the events that pass the filters (§11.3). */
  title: string;
  /** Digest only: the passing events, listed one per line. */
  events: EconomicEvent[];
  hiddenCount: number;
  /** §11.5 — a client-side pre-event alert rather than a server notification. */
  alert: boolean;
}

export interface ToastContent {
  show: boolean;
  title: string;
  events: EconomicEvent[];
  hiddenCount: number;
}

/**
 * §11.3 — toasts respect the calendar filters: an `event-due` toast shows
 * only if at least one of its events passes; a digest lists only passing
 * events and says how many were hidden. A notification with no events (the
 * empty-day digest) is shown as the server titled it.
 */
export function toastContent(notification: CalendarNotification, filters: CalendarFilters | null): ToastContent {
  const all = notification.events;
  const visible = filters ? all.filter((e) => passesFilters(e, filters)) : all;
  const hiddenCount = all.length - visible.length;
  if (all.length === 0) {
    return { show: true, title: notification.title, events: [], hiddenCount: 0 };
  }
  if (notification.kind === 'event-due') {
    return { show: visible.length > 0, title: eventGroupLabel(visible), events: [], hiddenCount };
  }
  const sorted = [...visible].sort((a, b) => a.scheduledAt - b.scheduledAt);
  const title = hiddenCount === 0 ? notification.title : `Today: ${visible.length} matching event${visible.length === 1 ? '' : 's'}`;
  return { show: true, title, events: sorted, hiddenCount };
}

let toastSeq = 0;

/**
 * §7 `notifications.store.ts` — last 50 notifications + unread count +
 * toast queue (§5.1). Seeded on boot from `GET /api/calendar/notifications`,
 * appended to live via the `calendar` WS topic (subscribed once, regardless
 * of the active view — toasts must show on the charts view too).
 */
@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly center = signal<CalendarNotification[]>([]);
  private readonly unread = signal(0);
  private readonly toasts = signal<Toast[]>([]);
  private readonly desktopOptIn = signal(this.readStoredDesktopOptIn());
  private readonly seenIds = new Set<string>();

  readonly notifications = this.center.asReadonly();
  readonly unreadCount = this.unread.asReadonly();
  readonly toastQueue = this.toasts.asReadonly();
  readonly desktopNotificationsEnabled = this.desktopOptIn.asReadonly();
  readonly hasUnread = computed(() => this.unread() > 0);

  /** Boot seed: replaces the center wholesale, marks everything already-seen (not unread — the user hasn't "missed" history on first load). */
  seed(notifications: CalendarNotification[]): void {
    const sorted = [...notifications].sort((a, b) => b.at - a.at).slice(0, MAX_CENTER_ITEMS);
    this.center.set(sorted);
    for (const n of sorted) {
      this.seenIds.add(n.id);
    }
  }

  /**
   * A frame off the `calendar` WS topic: append to the center, bump unread,
   * enqueue a toast — deduped by deterministic id (§5.4). The centre keeps
   * every notification; only the toast is subject to `filters` (§11.3).
   */
  receive(notification: CalendarNotification, filters: CalendarFilters | null = null): void {
    if (this.seenIds.has(notification.id)) {
      return;
    }
    this.seenIds.add(notification.id);
    this.center.update((current) => [notification, ...current].slice(0, MAX_CENTER_ITEMS));
    this.unread.update((n) => n + 1);
    const content = toastContent(notification, filters);
    if (!content.show) {
      return;
    }
    this.toasts.update((current) => [
      ...current,
      {
        toastId: `toast-${++toastSeq}`,
        notification,
        sticky: notification.kind === 'daily-digest',
        title: content.title,
        events: content.events,
        hiddenCount: content.hiddenCount,
        alert: false,
      },
    ]);
  }

  /** §11.5 — a pre-event alert toast (`In 5 min: 🇺🇸 USD · High · CPI m/m`). Not added to the centre. */
  pushAlert(key: string, events: EconomicEvent[], title: string, at: number): void {
    const notification: CalendarNotification = { id: key, kind: 'event-due', at, events, title };
    this.toasts.update((current) => [
      ...current,
      { toastId: `toast-${++toastSeq}`, notification, sticky: false, title, events: [], hiddenCount: 0, alert: true },
    ]);
  }

  dismissToast(toastId: string): void {
    this.toasts.update((current) => current.filter((t) => t.toastId !== toastId));
  }

  markAllRead(): void {
    this.unread.set(0);
  }

  setDesktopNotificationsEnabled(enabled: boolean): void {
    this.desktopOptIn.set(enabled);
    try {
      localStorage.setItem(DESKTOP_OPT_IN_KEY, enabled ? '1' : '0');
    } catch {
      // localStorage unavailable — the toggle still works in-memory for this session
    }
  }

  private readStoredDesktopOptIn(): boolean {
    try {
      return localStorage.getItem(DESKTOP_OPT_IN_KEY) === '1';
    } catch {
      return false;
    }
  }
}

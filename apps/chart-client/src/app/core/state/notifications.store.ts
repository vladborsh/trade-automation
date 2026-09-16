import { Injectable, computed, signal } from '@angular/core';
import type { CalendarNotification } from '../contracts/calendar';

const MAX_CENTER_ITEMS = 50;
const DESKTOP_OPT_IN_KEY = 'chart-client:desktop-notifications';

export interface Toast {
  toastId: string; // distinct from CalendarNotification.id in case the same notification is re-shown
  notification: CalendarNotification;
  sticky: boolean; // §5.1: digest is sticky until dismissed, event-due auto-dismisses
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

  /** A frame off the `calendar` WS topic: append to the center, bump unread, enqueue a toast — deduped by deterministic id (§5.4). */
  receive(notification: CalendarNotification): void {
    if (this.seenIds.has(notification.id)) {
      return;
    }
    this.seenIds.add(notification.id);
    this.center.update((current) => [notification, ...current].slice(0, MAX_CENTER_ITEMS));
    this.unread.update((n) => n + 1);
    this.toasts.update((current) => [
      ...current,
      { toastId: `toast-${++toastSeq}`, notification, sticky: notification.kind === 'daily-digest' },
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

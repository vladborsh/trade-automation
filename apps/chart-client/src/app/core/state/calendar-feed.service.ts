import { Injectable } from '@angular/core';
import { RestClient } from '../api/rest.client';
import { LiveSocket } from '../api/live.socket';
import { CalendarStore } from './calendar.store';
import { NotificationsStore } from './notifications.store';

/**
 * §7 — boots the calendar feature independently of the active view: the
 * `calendar` WS topic is subscribed once at boot regardless of whether the
 * charts or calendar view is showing, because notifications must reach the
 * user everywhere (§7.1). Mirrors `LayoutFeedService`'s boot/reconnect
 * shape but is not driven by any panel/layout state.
 */
@Injectable({ providedIn: 'root' })
export class CalendarFeedService {
  private booted = false;

  constructor(
    private readonly rest: RestClient,
    private readonly socket: LiveSocket,
    private readonly calendar: CalendarStore,
    private readonly notifications: NotificationsStore,
  ) {}

  async boot(): Promise<void> {
    if (this.booted) {
      return;
    }
    this.booted = true;

    const [week, notificationHistory] = await Promise.all([
      this.rest.getCalendarWeek(),
      this.rest.getCalendarNotifications(),
    ]);
    this.calendar.setWeek(week);
    this.notifications.seed(notificationHistory);

    this.socket.calendarEventFrames$.subscribe((frame) => this.calendar.mergeLive(frame.event));
    this.socket.notificationFrames$.subscribe((frame) => this.notifications.receive(frame.notification));
    this.socket.reconnected.subscribe(() => void this.healAfterReconnect());

    this.socket.subscribeCalendar();
  }

  /** Week navigation (prev/next arrows, §7.1) — does not touch notifications. */
  async loadWeek(at?: number): Promise<void> {
    const week = await this.rest.getCalendarWeek(at);
    this.calendar.setWeek(week);
  }

  /**
   * §6.2 "never assume nothing was missed" — re-fetch the current week and
   * recent notifications on reconnect. `receive()` already dedupes by id
   * (§5.4), so already-seen notifications are silently absorbed and only
   * genuinely missed ones surface a toast.
   */
  private async healAfterReconnect(): Promise<void> {
    const [week, notificationHistory] = await Promise.all([
      this.rest.getCalendarWeek(),
      this.rest.getCalendarNotifications(),
    ]);
    this.calendar.setWeek(week);
    for (const notification of notificationHistory) {
      this.notifications.receive(notification);
    }
  }
}

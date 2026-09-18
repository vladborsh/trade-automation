import { ChangeDetectionStrategy, Component, effect } from '@angular/core';
import { NotificationsStore, type Toast } from '../../core/state/notifications.store';
import { CalendarStore } from '../../core/state/calendar.store';
import { ViewStore } from '../../core/state/view.store';

const EVENT_DUE_AUTO_DISMISS_MS = 15_000;

/**
 * §5.1 — fixed bottom-right toast stack, overlaying either view (the
 * calendar topic is subscribed regardless of the active view, §7.1).
 * `event-due` toasts auto-dismiss after 15s; `daily-digest` toasts are
 * sticky until the user dismisses or clicks them. Clicking any toast
 * switches to the calendar view and highlights the corresponding row.
 */
@Component({
  selector: 'app-toast-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toast-host.component.html',
  styleUrl: './toast-host.component.scss',
})
export class ToastHostComponent {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    readonly notifications: NotificationsStore,
    private readonly calendar: CalendarStore,
    private readonly view: ViewStore,
  ) {
    effect(() => {
      for (const toast of this.notifications.toastQueue()) {
        if (!toast.sticky && !this.timers.has(toast.toastId)) {
          const timer = setTimeout(() => {
            this.notifications.dismissToast(toast.toastId);
            this.timers.delete(toast.toastId);
          }, EVENT_DUE_AUTO_DISMISS_MS);
          this.timers.set(toast.toastId, timer);
        }
      }
    });
  }

  onToastClick(toast: Toast): void {
    const eventId = toast.notification.events[0]?.id;
    this.view.set('calendar');
    if (eventId) {
      this.calendar.highlight(eventId);
    }
    this.notifications.dismissToast(toast.toastId);
  }

  onDismiss(event: Event, toast: Toast): void {
    event.stopPropagation();
    this.notifications.dismissToast(toast.toastId);
  }
}

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
  template: `
    <div class="toast-host">
      @for (toast of notifications.toastQueue(); track toast.toastId) {
        <div class="toast" [class]="'kind-' + toast.notification.kind" (click)="onToastClick(toast)">
          <span class="toast-title">{{ toast.notification.title }}</span>
          <button type="button" class="dismiss" (click)="onDismiss($event, toast)" aria-label="Dismiss">×</button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-host {
        position: fixed;
        bottom: 16px;
        right: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 100;
        max-width: 340px;
      }
      .toast {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        background: #161b22;
        border: 1px solid #30363d;
        border-left: 3px solid #58a6ff;
        padding: 10px 12px;
        cursor: pointer;
        font-size: 12px;
        color: #c9d1d9;
      }
      .toast.kind-daily-digest {
        border-left-color: #d29922;
      }
      .toast-title {
        flex: 1;
      }
      .dismiss {
        background: none;
        border: none;
        color: #8b949e;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
      }
    `,
  ],
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

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NotificationsStore } from '../../core/state/notifications.store';
import { NotificationCenterComponent } from './notification-center.component';

/**
 * §7 — bell icon with an unread count; opens the notification centre
 * (§5.1). Visible in the top bar of both views.
 */
@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [NotificationCenterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bell-wrap">
      <button type="button" class="bell" (click)="toggle()" aria-label="Notifications">
        🔔
        @if (notifications.hasUnread()) {
          <span class="badge">{{ notifications.unreadCount() }}</span>
        }
      </button>
      @if (open()) {
        <app-notification-center (closed)="open.set(false)" />
      }
    </div>
  `,
  styles: [
    `
      .bell-wrap {
        position: relative;
      }
      .bell {
        position: relative;
        background: none;
        border: none;
        color: #c9d1d9;
        font-size: 15px;
        cursor: pointer;
        padding: 4px 6px;
      }
      .badge {
        position: absolute;
        top: 0;
        right: 0;
        background: #ef5350;
        color: white;
        font-size: 10px;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 8px;
      }
    `,
  ],
})
export class NotificationBellComponent {
  readonly open = signal(false);

  constructor(readonly notifications: NotificationsStore) {}

  toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) {
      this.notifications.markAllRead();
    }
  }
}

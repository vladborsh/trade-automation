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
  templateUrl: './notification-bell.component.html',
  styleUrl: './notification-bell.component.scss',
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

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';
import { NotificationsStore } from '../../core/state/notifications.store';

/** §5.1 — last 50 notifications + the "Desktop notifications" opt-in toggle. */
@Component({
  selector: 'app-notification-center',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notification-center.component.html',
  styleUrl: './notification-center.component.scss',
})
export class NotificationCenterComponent {
  @Output() readonly closed = new EventEmitter<void>();

  constructor(readonly notifications: NotificationsStore) {}

  onToggleDesktop(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    this.notifications.setDesktopNotificationsEnabled(checked);
  }
}

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';
import { NotificationsStore } from '../../core/state/notifications.store';

/** §5.1 — last 50 notifications + the "Desktop notifications" opt-in toggle. */
@Component({
  selector: 'app-notification-center',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="center">
      <div class="center-header">
        <span>Notifications</span>
        <button type="button" class="close" (click)="closed.emit()" aria-label="Close">×</button>
      </div>
      <label class="desktop-toggle">
        <input type="checkbox" [checked]="notifications.desktopNotificationsEnabled()" (change)="onToggleDesktop($event)" />
        Desktop notifications
      </label>
      <div class="list">
        @for (n of notifications.notifications(); track n.id) {
          <div class="item" [class]="'kind-' + n.kind">
            <span class="title">{{ n.title }}</span>
            <span class="at">{{ n.at | date: 'short' }}</span>
          </div>
        } @empty {
          <div class="empty">No notifications yet.</div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .center {
        position: absolute;
        top: 28px;
        right: 0;
        width: 320px;
        max-height: 420px;
        overflow-y: auto;
        background: #161b22;
        border: 1px solid #30363d;
        z-index: 50;
        font-size: 12px;
      }
      .center-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 10px;
        border-bottom: 1px solid #30363d;
        font-weight: 600;
      }
      .close {
        background: none;
        border: none;
        color: #8b949e;
        cursor: pointer;
        font-size: 14px;
      }
      .desktop-toggle {
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 8px 10px;
        border-bottom: 1px solid #30363d;
        color: #8b949e;
      }
      .item {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 10px;
        border-bottom: 1px solid #21262d;
      }
      .kind-daily-digest .title {
        color: #58a6ff;
      }
      .at {
        color: #8b949e;
        font-size: 10px;
      }
      .empty {
        padding: 12px 10px;
        color: #8b949e;
      }
    `,
  ],
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

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { AdminUser } from '@trade-automation/contracts';
import { canDisable, formatUtc } from './admin-view';

/**
 * The users table of the admin page (§7.1): email, role, created, disabled, with disable/enable.
 * Decision 30 — account fields only; no link to anyone's sessions or journal.
 */
@Component({
  selector: 'app-admin-users-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-users-table.component.html',
  styleUrl: './admin-users-table.component.scss',
})
export class AdminUsersTableComponent {
  readonly users = input.required<AdminUser[]>();
  readonly currentUserId = input<string | null>(null);
  /** The id whose action is in flight. */
  readonly busy = input<string | null>(null);
  /** The user whose disable awaits confirmation. */
  readonly confirming = input<string | null>(null);

  readonly askDisable = output<string>();
  readonly confirmDisable = output<string>();
  readonly cancelDisable = output<void>();
  readonly enable = output<string>();

  protected readonly formatUtc = formatUtc;

  protected canDisable(user: AdminUser): boolean {
    return canDisable(user, this.currentUserId());
  }

  protected isSelf(user: AdminUser): boolean {
    return user.id === this.currentUserId();
  }
}

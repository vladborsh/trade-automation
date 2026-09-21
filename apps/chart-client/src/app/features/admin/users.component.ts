import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { AppNavComponent } from '../nav/app-nav.component';
import { AdminInvitesComponent } from './admin-invites.component';
import { AdminStore } from './admin.store';
import { AdminUsersTableComponent } from './admin-users-table.component';

/**
 * §2.3 `/admin/users` (auth + admin guards): users and invites, and nothing else (decision 30 —
 * the admin never sees anyone's sessions or journal). The store is provided here, so the one-time
 * invite URL disappears with the page.
 */
@Component({
  selector: 'app-users',
  standalone: true,
  imports: [AppNavComponent, AdminUsersTableComponent, AdminInvitesComponent],
  providers: [AdminStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.component.html',
  styleUrl: './users.component.scss',
})
export class UsersComponent implements OnInit {
  protected readonly store = inject(AdminStore);
  private readonly auth = inject(AuthService);
  protected readonly currentUserId = computed(() => this.auth.user()?.id ?? null);

  ngOnInit(): void {
    void this.store.load();
  }
}

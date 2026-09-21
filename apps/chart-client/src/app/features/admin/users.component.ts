import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AppNavComponent } from '../nav/app-nav.component';

/** §2.3 `/admin/users` (auth + admin) — placeholder until the admin users task lands. */
@Component({
  selector: 'app-users',
  standalone: true,
  imports: [AppNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.component.html',
  styleUrl: './users.component.scss',
})
export class UsersComponent {}

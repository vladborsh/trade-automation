import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppNavComponent } from '../nav/app-nav.component';

/** §2.3 `/sessions` (default route) — placeholder until the session list task lands. */
@Component({
  selector: 'app-session-list',
  standalone: true,
  imports: [AppNavComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-list.component.html',
  styleUrl: './session-list.component.scss',
})
export class SessionListComponent {}

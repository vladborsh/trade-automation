import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { navLinks } from './nav-links';

/** Top bar of the authenticated pages (not the terminal, which keeps its own full-height shell). */
@Component({
  selector: 'app-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-nav.component.html',
  styleUrl: './app-nav.component.scss',
})
export class AppNavComponent {
  private readonly auth = inject(AuthService);

  readonly user = this.auth.user;
  readonly links = computed(() => navLinks(this.user()?.role ?? null));

  logout(): void {
    void this.auth.logout();
  }
}

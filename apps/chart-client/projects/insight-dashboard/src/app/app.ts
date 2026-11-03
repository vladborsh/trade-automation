import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { CalendarAlertsService } from './core/calendar-alerts.service';
import { SessionService } from './core/session.service';
import { I18nService } from './i18n/i18n.service';
import { AlertsToggleComponent } from './ui/alerts-toggle.component';
import { AccountMenuComponent } from './ui/account-menu.component';
import { PUBLIC_PAGES } from './core/insight-api.client';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AlertsToggleComponent, AccountMenuComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly i18n = inject(I18nService);
  /** §11: every string comes from the table; `t` is how a template reaches it. */
  readonly t = this.i18n.t.bind(this.i18n);
  private readonly session = inject(SessionService);
  /** IB-075: the Health and (IB-079) login-journal links are offered to an admin only (the server refuses members anyway). */
  readonly isAdmin = this.session.isAdmin;

  constructor() {
    // IB-061: app-wide, so an alert rings on whichever page the member has open
    inject(CalendarAlertsService).start();
    // IB-075: a login happens on /login and then navigates in; asking again on the next navigation
    // while nobody is known is how the nav learns the role. `ensure()` is free once a member is known.
    const sub = inject(Router)
      .events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        // not on /login or /set-password: nobody is signed in there by design (IB-079)
        const path = e.urlAfterRedirects.split('?')[0];
        if (!PUBLIC_PAGES.includes(path)) void this.session.ensure();
      });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }
}

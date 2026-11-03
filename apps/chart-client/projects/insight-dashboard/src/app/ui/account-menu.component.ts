import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { InsightApiClient } from '../core/insight-api.client';
import { SessionService } from '../core/session.service';
import { I18nService } from '../i18n/i18n.service';

/**
 * IB-079 (password-login design §1, P9) — the header's account links: the account page, "log out"
 * and "log out everywhere". Shown only while a member is known. Both logouts forget the member in
 * the shell (`signedOut`) before going to /login, so the next person to sign in on this browser
 * does not inherit the previous member's nav.
 */
@Component({
  selector: 'app-account-menu',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './account-menu.component.html',
  styleUrl: './account-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountMenuComponent {
  private readonly api = inject(InsightApiClient);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly document = inject(DOCUMENT);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly user = this.session.user;

  async logout(): Promise<void> {
    await this.leave(() => this.api.logout());
  }

  /** One confirmation, because it also ends the session on THIS device. */
  async logoutAll(): Promise<void> {
    if (!this.document.defaultView?.confirm(this.t('menu.logoutAllConfirm'))) return;
    await this.leave(() => this.api.logoutAll());
  }

  private async leave(call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch {
      // the cookie may already be dead; the page still goes to /login and forgets the member
    }
    this.session.signedOut();
    await this.router.navigateByUrl('/login');
  }
}

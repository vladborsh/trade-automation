import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError } from '@backtest-core/api/api-error';
import { LANDING_ROUTE } from '../../app.routes';
import { InsightApiClient } from '../../core/insight-api.client';
import { SessionService } from '../../core/session.service';
import { I18nService } from '../../i18n/i18n.service';
import { loginFailure, type Message } from '../auth/auth-messages';

/**
 * IB-079 (password-login design §1, P1) — sign in with a login and a password. The bot is no longer
 * a way in: it only sends the set-password link (`/password`), which this page names under the form.
 *
 * §11: there is no member yet, so the page starts in the stored language and carries its own switch.
 * Once signed in, the member's own `lang` decides every screen.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly router = inject(Router);
  private readonly api = inject(InsightApiClient);
  private readonly session = inject(SessionService);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  /** `?login=` — filled in after the set-password page, so the member only types the password. */
  readonly loginParam = input<string | undefined>(undefined, { alias: 'login' });
  /** `?saved=1` — "password saved, sign in". */
  readonly saved = input<string | undefined>(undefined);

  readonly login = signal('');
  readonly password = signal('');
  readonly busy = signal(false);
  readonly error = signal<Message | null>(null);
  /** Which bot to message for `/password`; null hides the handle rather than printing a wrong one. */
  readonly botUsername = signal<string | null>(null);

  constructor() {
    void this.loadContext();
    effect(() => {
      const preset = this.loginParam();
      if (preset) this.login.set(preset);
    });
  }

  private async loadContext(): Promise<void> {
    try {
      const { botUsername } = await this.api.authContext();
      if (botUsername.length > 0) this.botUsername.set(botUsername);
    } catch {
      // the hint is help, not a requirement
    }
  }

  toggleLang(): void {
    this.i18n.setLang(this.i18n.lang() === 'ru' ? 'en' : 'ru');
  }

  async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { user } = await this.api.login({ login: this.login(), password: this.password() });
      this.session.signedIn(user);
      this.i18n.setLangFromUser(user.lang);
      await this.router.navigateByUrl(LANDING_ROUTE);
    } catch (error) {
      this.password.set('');
      this.error.set(loginFailure(error instanceof ApiError ? error.status : 0));
    } finally {
      this.busy.set(false);
    }
  }
}

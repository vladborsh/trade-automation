import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError } from '@backtest-core/api/api-error';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { setPasswordFailure, ruleMessage, type Message } from '../auth/auth-messages';
import { loginProblem, normalizeLogin, passwordProblem } from '../auth/auth-rules';

type View = 'checking' | 'form' | 'dead';

/**
 * IB-079 (password-login design §1, P1–P3) — the page the bot's one link opens:
 * `/set-password?t=…`. `GET /auth/credentials` decides the form without spending the link: no
 * account yet → choose a login + password; an account → the login shown read-only + a new password.
 *
 * Success opens NO session (P1): the member is sent to /login with the login filled in and types the
 * new password once more — which proves it works before they rely on it.
 */
@Component({
  selector: 'app-set-password',
  standalone: true,
  templateUrl: './set-password.component.html',
  styleUrl: './set-password.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetPasswordComponent {
  private readonly api = inject(InsightApiClient);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  /** The link's token, bound from `?t=`. */
  readonly token = input<string | undefined>(undefined, { alias: 't' });

  readonly view = signal<View>('checking');
  /** Set when the account already has a login: shown, not editable (a reset keeps it). */
  readonly existingLogin = signal<string | null>(null);
  readonly login = signal('');
  readonly password = signal('');
  readonly repeat = signal('');
  readonly busy = signal(false);
  readonly error = signal<Message | null>(null);

  constructor() {
    effect(() => void this.check(this.token()));
  }

  private async check(token: string | undefined): Promise<void> {
    if (!token) {
      this.view.set('dead');
      return;
    }
    try {
      const info = await this.api.credentialsInfo(token);
      this.existingLogin.set(info.hasLogin ? (info.login ?? null) : null);
      this.view.set('form');
    } catch {
      this.view.set('dead');
    }
  }

  async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    const token = this.token();
    if (!token || this.busy()) return;

    const existing = this.existingLogin();
    const login = existing ?? normalizeLogin(this.login());
    const problem = (existing ? null : loginProblem(login)) ?? passwordProblem(this.password(), this.repeat(), login);
    if (problem) {
      this.error.set(ruleMessage(problem));
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.setCredentials(existing ? { token, password: this.password() } : { token, login, password: this.password() });
      await this.router.navigate(['/login'], { queryParams: { login, saved: 1 } });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      const failure = setPasswordFailure(status, error instanceof ApiError ? error.code : null);
      // a dead link cannot be retried from here; a taken login or a rule can
      if (status === 401 || status === 410) this.view.set('dead');
      this.error.set(failure);
    } finally {
      this.busy.set(false);
    }
  }
}

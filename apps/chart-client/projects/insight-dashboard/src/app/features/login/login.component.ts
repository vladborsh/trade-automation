import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError } from '@backtest-core/api/api-error';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';

/**
 * architecture/insight-bot-web-dashboard.md §4 W3 — the bot's `/web` command sends a single-use
 * link; this page exchanges its `?t=` for the `ib_session` cookie and goes to /health.
 *
 * §11: there is no user here yet, so the page starts in the stored language (`ru` by default) and
 * carries its own switch. Once the exchange succeeds, `/auth/me` decides the language everywhere.
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
  private readonly i18n = inject(I18nService);
  private readonly api = inject(InsightApiClient);
  readonly t = this.i18n.t.bind(this.i18n);

  /** Bound from the query string by `withComponentInputBinding()`. */
  readonly t_ = input<string | undefined>(undefined, { alias: 't' });

  readonly state = signal<'idle' | 'exchanging' | 'failed'>('idle');
  readonly message = signal<string | null>(null);

  constructor() {
    // The link IS the sign-in: arriving with a token exchanges it straight away. Waiting for a
    // click asks a member to confirm what they already did by opening the bot's link, and the
    // token is one-use and ten minutes old, so the click only spends it later.
    //
    // This was lost once already — IB-BUG-004's i18n rewrite of this file dropped it, because
    // nothing failed when it went. `login.component.spec.ts` now covers it for that reason.
    effect(() => {
      const token = this.t_();
      if (token) untracked(() => void this.exchange());
    });
  }

  toggleLang(): void {
    this.i18n.setLang(this.i18n.lang() === 'ru' ? 'en' : 'ru');
  }

  async exchange(): Promise<void> {
    const token = this.t_();
    if (!token) {
      this.fail('login.noToken');
      return;
    }
    this.state.set('exchanging');
    try {
      const { user } = await this.api.exchange(token);
      // the member exists now, so their own language decides every screen from here
      this.i18n.setLangFromUser(user?.lang);
      await this.router.navigateByUrl('/health');
    } catch (error) {
      if (!(error instanceof ApiError)) return this.fail('login.unreachable');
      const { key, params } = loginFailure(error.code, error.status);
      this.fail(key, params);
    }
  }

  private fail(key: StringKey, params?: Record<string, string | number>): void {
    this.state.set('failed');
    this.message.set(this.t(key, params));
  }
}

/**
 * Pure: which string a failure gets, chosen by the server's `code` — not by the status.
 *
 * `TOKEN_USED` and `TOKEN_EXPIRED` are BOTH HTTP 410 and mean different things to the person
 * holding the link: one forwarded it or opened it twice, the other let it go stale. Branching on
 * the status cannot tell them apart, and this file did exactly that for a while after IB-BUG-004's
 * rewrite — which is what the spec below now prevents.
 */
export function loginFailure(code: string | null | undefined, status: number): { key: StringKey; params?: Record<string, string | number> } {
  switch (code) {
    case 'TOKEN_INVALID':
      return { key: 'login.invalid' };
    case 'TOKEN_USED':
      return { key: 'login.used' };
    case 'TOKEN_EXPIRED':
      return { key: 'login.expired' };
    default:
      return { key: 'login.failed', params: { status } };
  }
}

import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
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
  readonly t = this.i18n.t.bind(this.i18n);

  /** Bound from the query string by `withComponentInputBinding()`. */
  readonly t_ = input<string | undefined>(undefined, { alias: 't' });

  readonly state = signal<'idle' | 'exchanging' | 'failed'>('idle');
  readonly message = signal<string | null>(null);

  /**
   * IB-BUG-008 — which bot to message, from `TELEGRAM_BOT_USERNAME` on the server. Null until it
   * arrives (or if the call fails), and the template hides the hint rather than printing
   * "@null": a wrong handle is worse than no handle, because someone will message it.
   */
  readonly botUsername = signal<string | null>(null);

  constructor() {
    void this.loadContext();
  }

  private async loadContext(): Promise<void> {
    try {
      const response = await fetch('/api/web/auth/context', { credentials: 'include' });
      if (!response.ok) return;
      const body = (await response.json()) as { botUsername?: unknown };
      if (typeof body.botUsername === 'string' && body.botUsername.length > 0) {
        this.botUsername.set(body.botUsername);
      }
    } catch {
      // the hint is help, not a requirement: the page still works without it
    }
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
      const response = await fetch('/api/web/auth/exchange', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        const { key, params } = loginFailure(response.status);
        this.fail(key, params);
        return;
      }
      // the member exists now, so their own language decides every screen from here
      const body = (await response.json()) as { user?: { lang?: unknown } };
      this.i18n.setLangFromUser(body.user?.lang);
      await this.router.navigateByUrl('/health');
    } catch {
      this.fail('login.unreachable');
    }
  }

  private fail(key: StringKey, params?: Record<string, string | number>): void {
    this.state.set('failed');
    this.message.set(this.t(key, params));
  }
}

/**
 * Pure: which string a failure gets. IB-029 defines the codes, and each is reachable by an ordinary
 * mistake — forwarding the link, opening it twice, letting it sit for ten minutes — so each gets its
 * own sentence with the way out in it rather than a shared "failed".
 */
export function loginFailure(status: number): { key: StringKey; params?: Record<string, string | number> } {
  if (status === 401) return { key: 'login.invalid' };
  if (status === 410) return { key: 'login.used' };
  return { key: 'login.failed', params: { status } };
}

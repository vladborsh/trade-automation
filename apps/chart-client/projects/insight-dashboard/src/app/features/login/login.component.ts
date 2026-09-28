import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError } from '@backtest-core/api/api-error';
import { InsightApiClient } from '../../core/insight-api.client';

/**
 * architecture/insight-bot-web-dashboard.md §4 W3 — the bot's `/web` command sends a single-use
 * link; this page exchanges its `?t=` for the `ib_session` cookie and goes to /health.
 *
 * **IB-029 owns the endpoint and its contracts** (`POST /api/web/auth/exchange`), and they are on
 * master, so the call goes through `InsightApiClient` against `WebExchangeResponse` — no local
 * transcription of someone else's shape.
 *
 * The failure is read from the server's `{ code }`, never from the status alone: `TOKEN_USED` and
 * `TOKEN_EXPIRED` share HTTP 410 and are different things to a member — one forwarded their link,
 * the other let it go stale — so each gets its own sentence.
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

  constructor() {
    // The link IS the sign-in: arriving with a token exchanges it straight away. Waiting for a
    // click would ask a member to confirm something they already did by opening the bot's link,
    // and the token is one-use and ten minutes old, so the click is only a way to waste it.
    effect(() => {
      const token = this.t();
      if (token) untracked(() => void this.exchange());
    });
  }

  /** Bound from the query string by `withComponentInputBinding()`. */
  readonly t = input<string | undefined>(undefined);

  readonly state = signal<'idle' | 'exchanging' | 'failed'>('idle');
  readonly message = signal<string | null>(null);

  async exchange(): Promise<void> {
    const token = this.t();
    if (!token) {
      this.state.set('failed');
      this.message.set('This link carries no token. Ask the bot for a new one with /web.');
      return;
    }
    this.state.set('exchanging');
    try {
      await this.api.exchange(token);
      await this.router.navigateByUrl('/health');
    } catch (error) {
      this.state.set('failed');
      this.message.set(
        error instanceof ApiError
          ? loginFailureMessage(error.code, error.status)
          : 'Could not reach the server. Try again in a moment.',
      );
    }
  }
}

/**
 * Pure: the sentence a member sees for each failure IB-029 defines. Branches on the server's
 * `code` (the one thing a client should branch on, per the `/api/web` error contract); the status
 * is only a fallback for a proxy or a body that never reached us.
 */
export function loginFailureMessage(code: string | null | undefined, status: number): string {
  switch (code) {
    case 'TOKEN_INVALID':
      return 'This link is not valid. Ask the bot for a new one with /web.';
    case 'TOKEN_USED':
      return 'This link has already been used. Ask the bot for a new one with /web.';
    case 'TOKEN_EXPIRED':
      return 'This link has expired. Ask the bot for a new one with /web.';
    default:
      return `Sign-in failed (HTTP ${status}).`;
  }
}

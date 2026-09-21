import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { InviteInfo } from '@trade-automation/contracts';
import { isApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { DEFAULT_AUTHED_URL } from '../../core/auth/return-url';
import { acceptErrorMessage } from './auth-messages';
import { hasErrors, validateSetPassword } from './auth-form.validation';
import { type InviteState, inviteStateFromError } from './invite-state';

/**
 * backtest-app-system-design.md §2.3/§7.1 — `/invite/:token`, public. Shows the invite's state
 * (unknown / used / expired) or a set-password form; accepting signs the new user in.
 */
@Component({
  selector: 'app-invite-accept',
  standalone: true,
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invite-accept.component.html',
  styleUrl: './invite-accept.component.scss',
})
export class InviteAcceptComponent {
  /** The `:token` route parameter. */
  readonly token = input.required<string>();

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly state = signal<InviteState>('loading');
  readonly invite = signal<InviteInfo | null>(null);
  readonly email = signal('');
  readonly password = signal('');
  readonly confirm = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  private readonly submitted = signal(false);

  /** An invite issued for a specific address fixes the email; an open invite lets the user pick. */
  readonly emailLocked = computed(() => this.invite()?.email != null);
  readonly fieldErrors = computed(() =>
    this.submitted() ? validateSetPassword({ email: this.email(), password: this.password(), confirm: this.confirm() }) : {},
  );

  constructor() {
    effect(() => {
      const token = this.token();
      untracked(() => void this.load(token));
    });
  }

  async load(token: string = this.token()): Promise<void> {
    this.state.set('loading');
    try {
      const info = await this.auth.getInvite(token);
      this.invite.set(info);
      this.email.set(info.email ?? '');
      this.state.set('valid');
    } catch (err) {
      this.state.set(inviteStateFromError(err));
    }
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    if (this.busy() || hasErrors(this.fieldErrors())) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.acceptInvite(this.token(), this.email().trim(), this.password());
      await this.router.navigateByUrl(DEFAULT_AUTHED_URL);
    } catch (err) {
      // Used or expired between opening the page and submitting: show that state, not a form error.
      if (isApiError(err) && (err.code === 'INVITE_USED' || err.code === 'INVITE_EXPIRED' || err.code === 'INVITE_UNKNOWN')) {
        this.state.set(inviteStateFromError(err));
      } else {
        this.error.set(acceptErrorMessage(err));
      }
    } finally {
      this.busy.set(false);
    }
  }
}

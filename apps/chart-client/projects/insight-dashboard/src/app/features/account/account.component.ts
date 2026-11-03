import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ApiError } from '@backtest-core/api/api-error';
import { InsightApiClient } from '../../core/insight-api.client';
import { SessionService } from '../../core/session.service';
import { I18nService } from '../../i18n/i18n.service';
import { changePasswordFailure, ruleMessage, type Message } from '../auth/auth-messages';
import { passwordProblem } from '../auth/auth-rules';

/**
 * IB-079 (password-login design P9) — change the password while signed in. The server ends every
 * OTHER session and keeps this one, which is what the success sentence says.
 */
@Component({
  selector: 'app-account',
  standalone: true,
  templateUrl: './account.component.html',
  styleUrl: './account.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly user = inject(SessionService).user;

  readonly current = signal('');
  readonly next = signal('');
  readonly repeat = signal('');
  readonly busy = signal(false);
  readonly error = signal<Message | null>(null);
  readonly changed = signal(false);

  async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.busy()) return;
    this.changed.set(false);
    const problem = passwordProblem(this.next(), this.repeat(), this.user()?.login ?? '');
    if (problem) {
      this.error.set(ruleMessage(problem));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.changePassword({ current: this.current(), next: this.next() });
      this.changed.set(true);
      for (const field of [this.current, this.next, this.repeat]) field.set('');
    } catch (error) {
      this.error.set(changePasswordFailure(error instanceof ApiError ? error.status : 0));
    } finally {
      this.busy.set(false);
    }
  }
}

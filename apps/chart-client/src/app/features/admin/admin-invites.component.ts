import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { AdminInvite, AdminUser } from '@trade-automation/contracts';
import type { CreatedInvite } from './admin.store';
import { canRevoke, formatUtc, inviteStatus, parseInviteEmail, usedByEmail } from './admin-view';

/**
 * The invites half of the admin page (§7.1): create (optional email), the one-time invite URL
 * with a copy button, and the list with revoke for unused invites. The URL is only ever shown
 * from `created` (the create response) — the list never carries it, and nothing persists it.
 */
@Component({
  selector: 'app-admin-invites',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-invites.component.html',
  styleUrl: './admin-invites.component.scss',
})
export class AdminInvitesComponent {
  readonly invites = input.required<AdminInvite[]>();
  readonly users = input.required<AdminUser[]>();
  readonly created = input<CreatedInvite | null>(null);
  readonly busy = input<string | null>(null);

  readonly create = output<string | undefined>();
  readonly revoke = output<string>();
  readonly dismissCreated = output<void>();

  protected readonly email = signal('');
  protected readonly emailError = signal<string | null>(null);
  protected readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');

  protected readonly formatUtc = formatUtc;
  protected readonly canRevoke = canRevoke;

  protected status(invite: AdminInvite): string {
    const status = inviteStatus(invite, Date.now());
    if (status !== 'used') return status;
    const by = usedByEmail(invite, this.users());
    return by ? `used by ${by}` : 'used';
  }

  protected onEmailInput(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
    this.emailError.set(null);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const parsed = parseInviteEmail(this.email());
    if (!parsed.ok) {
      this.emailError.set('Enter a valid email address, or leave it empty.');
      return;
    }
    this.copyState.set('idle');
    this.create.emit(parsed.email);
    this.email.set('');
  }

  protected async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copyState.set('copied');
    } catch {
      this.copyState.set('failed');
    }
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { WebMember } from '@trade-automation/contracts';
import { ApiError } from '@backtest-core/api/api-error';
import { InsightApiClient } from '../../core/insight-api.client';
import { SessionService } from '../../core/session.service';
import type { StringKey } from '../../i18n/keys';
import { I18nService } from '../../i18n/i18n.service';
import { refusalKey, toMemberRow } from './member-rows';

/**
 * IB-035 — the admin's members page: who has access, their site login, last sign-in and live
 * sessions; disable / enable with a confirmation; a new invite whose link is shown once. Admin only
 * (route guard + nav link, IB-075's pattern; the server answers 403 to a member regardless).
 */
@Component({
  selector: 'app-admin-members',
  standalone: true,
  templateUrl: './admin-members.component.html',
  styleUrl: './admin-members.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminMembersComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  private readonly session = inject(SessionService);
  readonly t = this.i18n.t.bind(this.i18n);

  private readonly members = signal<WebMember[]>([]);
  readonly rows = computed(() => this.members().map((m) => toMemberRow(m, this.session.user()?.id ?? null)));
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  /** The row waiting for «Подтвердить», or null. */
  readonly confirming = signal<number | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<StringKey | null>(null);
  /** The new invite's link: shown once, gone on reload, never in the list. */
  readonly invite = signal<{ link: string; expiresAt: number } | null>(null);
  readonly copied = signal(false);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.members.set((await this.api.members()).members);
    } catch (error) {
      this.loadError.set((error as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  ask(id: number): void {
    this.actionError.set(null);
    this.confirming.set(id);
  }

  cancel(): void {
    this.confirming.set(null);
  }

  async confirm(id: number, disable: boolean): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const { member } = await this.api.setMemberDisabled(id, disable);
      this.members.update((list) => list.map((m) => (m.id === member.id ? member : m)));
      this.confirming.set(null);
    } catch (error) {
      this.actionError.set(error instanceof ApiError && error.status === 409 ? refusalKey(error.code) : 'members.failed');
    } finally {
      this.busy.set(false);
    }
  }

  async createInvite(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.copied.set(false);
    try {
      this.invite.set(await this.api.createInvite());
    } catch (error) {
      this.actionError.set(error instanceof ApiError && error.status === 409 ? refusalKey(error.code) : 'members.failed');
    } finally {
      this.busy.set(false);
    }
  }

  async copy(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(true);
    } catch {
      this.copied.set(false); // no clipboard (http, old browser): the link is still on screen to select
    }
  }

  inviteUntil(ms: number): string {
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
  }
}

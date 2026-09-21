import { Injectable, inject, signal } from '@angular/core';
import type { AdminInvite, AdminUser } from '@trade-automation/contracts';
import { RestClient } from '../../core/api/rest.client';
import { type AdminAction, adminErrorMessage } from './admin-view';

/** The one-time result of creating an invite. Held in memory only, never persisted. */
export interface CreatedInvite {
  url: string;
  expiresAt: number;
  email: string | null;
}

/**
 * State and actions of the admin page (§7.1, decision 30: users and invites, nothing else).
 * Provided by `UsersComponent`, so it lives and dies with the page — the one-time invite URL goes
 * with it on navigation or reload, which is exactly when the server will never show it again.
 */
@Injectable()
export class AdminStore {
  private readonly rest = inject(RestClient);

  readonly users = signal<AdminUser[]>([]);
  readonly invites = signal<AdminInvite[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** The row whose action is in flight (user or invite id; 'create' while creating). */
  readonly busy = signal<string | null>(null);
  /** The user whose disable is awaiting confirmation. */
  readonly confirmingDisable = signal<string | null>(null);
  readonly created = signal<CreatedInvite | null>(null);

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      await this.refresh();
      this.error.set(null);
    } catch (err) {
      this.error.set(adminErrorMessage('load', err));
    } finally {
      this.loading.set(false);
    }
  }

  askDisable(userId: string): void {
    this.confirmingDisable.set(userId);
  }

  cancelDisable(): void {
    this.confirmingDisable.set(null);
  }

  disable(userId: string): Promise<void> {
    this.confirmingDisable.set(null);
    return this.run('disable', userId, () => this.rest.disableUser(userId));
  }

  enable(userId: string): Promise<void> {
    return this.run('enable', userId, () => this.rest.enableUser(userId));
  }

  createInvite(email: string | undefined): Promise<void> {
    return this.run('create', 'create', async () => {
      const res = await this.rest.createInvite(email === undefined ? {} : { email });
      this.created.set({ url: res.url, expiresAt: res.expiresAt, email: email ?? null });
    });
  }

  revoke(inviteId: string): Promise<void> {
    return this.run('revoke', inviteId, () => this.rest.revokeInvite(inviteId));
  }

  dismissCreated(): void {
    this.created.set(null);
  }

  /** One action at a time: run it, then re-read both lists so the page shows the server's truth. */
  private async run(action: AdminAction, target: string, fn: () => Promise<void>): Promise<void> {
    this.busy.set(target);
    this.error.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(adminErrorMessage(action, err));
    } finally {
      try {
        await this.refresh();
      } catch {
        // keep the action's own message; the lists stay as they were
      }
      this.busy.set(null);
    }
  }

  private async refresh(): Promise<void> {
    const [users, invites] = await Promise.all([this.rest.listUsers(), this.rest.listInvites()]);
    this.users.set(users);
    this.invites.set(invites);
  }
}

import { ConflictException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AdminInvite, AdminUser, CreateInviteResponse } from '@trade-automation/contracts';
import { z } from 'zod';
import { AppConfigService } from '../config/config.service';
import { apiError } from './auth-error';
import { AUTH_REPOSITORIES, AuthRepositories } from './auth-repositories.port';
import { AUTH_CLOCK, Clock, INVITE_TTL_MS } from './auth.service';
import { InviteRecord } from './invite.repository.port';
import { newOpaqueToken, sha256Hex } from './session-cookie';
import { UserRecord } from './user.repository.port';

const UuidSchema = z.string().uuid();

/** Decision 30: exactly these fields, never session or journal data. */
export function toAdminUser(u: UserRecord): AdminUser {
  return { id: u.id, email: u.email, role: u.role, createdAt: u.createdAtMs, disabledAt: u.disabledAtMs };
}

/** Never the token or its hash. */
export function toAdminInvite(i: InviteRecord): AdminInvite {
  return { id: i.id, email: i.email, createdAt: i.createdAtMs, expiresAt: i.expiresAtMs, usedAt: i.usedAtMs, usedBy: i.usedBy };
}

/** `APP_BASE_URL + '/invite/' + token`, tolerating a trailing slash on the base. */
export function inviteUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/invite/${token}`;
}

/**
 * architecture/backtest-app-system-design.md §7.1, decision 30 — the admin manages users and
 * invites only. Nothing here reads backtest data, and no response carries it; tenancy of the
 * backtest routes is by user id, so the admin role widens nothing there.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(AUTH_REPOSITORIES) private readonly repos: AuthRepositories | null,
    private readonly config: AppConfigService,
    @Inject(AUTH_CLOCK) private readonly now: Clock,
  ) {}

  async listUsers(): Promise<AdminUser[]> {
    return (await this.requireEnabled().users.listAll()).map(toAdminUser);
  }

  /**
   * Sets `disabled_at` and deletes every `auth_sessions` row of the user in one transaction, so
   * their next request is a 401. An admin cannot disable themselves (plain 409; no contract code).
   */
  async disableUser(adminId: string, userId: string): Promise<void> {
    const repos = this.requireEnabled();
    if (!UuidSchema.safeParse(userId).success) throw userNotFound();
    if (userId === adminId) throw new ConflictException('An admin cannot disable their own account.');
    const now = this.now();
    await repos.transaction(async (tx) => {
      if (!(await tx.users.setDisabledAt(userId, now))) throw userNotFound();
      await tx.sessions.deleteAllForUser(userId);
    });
  }

  async enableUser(userId: string): Promise<void> {
    const repos = this.requireEnabled();
    if (!UuidSchema.safeParse(userId).success || !(await repos.users.setDisabledAt(userId, null))) throw userNotFound();
  }

  /** The raw token leaves the server exactly once, inside `url`; only `sha256(token)` is stored. */
  async createInvite(adminId: string, email: string | null): Promise<CreateInviteResponse> {
    const repos = this.requireEnabled();
    const token = newOpaqueToken();
    const now = this.now();
    const invite = await repos.invites.create({
      tokenHash: sha256Hex(token),
      email,
      createdBy: adminId,
      nowMs: now,
      expiresAtMs: now + INVITE_TTL_MS,
    });
    return { id: invite.id, url: inviteUrl(this.config.env.get('APP_BASE_URL') as string, token), expiresAt: invite.expiresAtMs };
  }

  async listInvites(): Promise<AdminInvite[]> {
    return (await this.requireEnabled().invites.listAll()).map(toAdminInvite);
  }

  /** Unused invites only (expired or not); a used one is 409 `INVITE_USED`. */
  async revokeInvite(inviteId: string): Promise<void> {
    const repos = this.requireEnabled();
    const outcome = UuidSchema.safeParse(inviteId).success ? await repos.invites.deleteUnused(inviteId) : 'missing';
    if (outcome === 'missing') throw new NotFoundException('Invite not found.');
    if (outcome === 'used') throw apiError(HttpStatus.CONFLICT, 'INVITE_USED', 'A used invite cannot be revoked.');
  }

  /** 503 when the DB module is disabled. */
  assertEnabled(): void {
    this.requireEnabled();
  }

  private requireEnabled(): AuthRepositories {
    if (!this.repos) throw new ServiceUnavailableException('auth disabled: DATABASE_URL not set');
    return this.repos;
  }
}

function userNotFound(): NotFoundException {
  return new NotFoundException('User not found.');
}

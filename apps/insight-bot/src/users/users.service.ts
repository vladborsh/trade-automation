import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import type { WebMemberRefusal } from '@trade-automation/contracts';
import { deleteSessionsForUser } from '../web/auth/pg/auth.repo';
import { disableRefusal, newInvite } from './members';
import type { Invite, User } from './user.model';
import type { UsersPort } from '../delivery/bot-handlers';
import * as repo from './pg/users.repo';

/**
 * IB-021 — the users port the bot talks to (design §3.5), and the admin bootstrap.
 *
 * Thin on purpose: the decisions live in the pure modules (`settings.ts`, `invite-code.ts`,
 * `templates/`) and the one piece of real concurrency lives in `repo.consumeInvite`'s
 * transaction. This class is the wiring between them and Nest.
 */
@Injectable()
export class UsersService implements OnApplicationBootstrap, UsersPort {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(DB) private readonly db: Db | null,
    private readonly config: AppConfigService,
  ) {}

  /** §3.5: the admin comes from env, so the table never needs a seed row. Idempotent. */
  async onApplicationBootstrap(): Promise<void> {
    const adminId = this.config.env.get('ADMIN_TG_USER_ID');
    if (!this.db || !adminId) {
      if (!adminId) this.logger.warn('ADMIN_TG_USER_ID is not set — no admin is bootstrapped, so /invite and /users answer nobody');
      return;
    }
    const admin = await repo.bootstrapAdmin(this.db, adminId);
    this.logger.log(`admin bootstrapped: tg_user_id=${admin.tgUserId}`);
  }

  private get required(): Db {
    if (!this.db) throw new Error('UsersService: no database. Set DATABASE_URL.');
    return this.db;
  }

  findByTgUserId(tgUserId: number): Promise<User | null> {
    return repo.findByTgUserId(this.required, tgUserId);
  }

  consumeInvite(code: string, tgUserId: number, chatId: number, now: Date): Promise<repo.ConsumeResult> {
    return repo.consumeInvite(this.required, code, tgUserId, chatId, now);
  }

  listUsers(): Promise<User[]> {
    return repo.listUsers(this.required);
  }

  updateSettings(userId: number, patch: repo.SettingsPatch): Promise<User | null> {
    return repo.updateSettings(this.required, userId, patch);
  }

  createInvite(code: string, createdBy: number, expiresAt: Date): Promise<Invite> {
    return repo.createInvite(this.required, code, createdBy, expiresAt);
  }

  async setChatId(userId: number, chatId: number): Promise<void> {
    await repo.setChatId(this.required, userId, chatId);
  }

  /**
   * IB-035 — the admin's members list: `listUsers` (the bot's `/users`) plus each member's site login,
   * last successful sign-in and live sessions.
   */
  async listMembers(now = new Date()): Promise<Array<User & { login: string | null; lastLoginAt: Date | null; activeSessions: number }>> {
    const [users, activity] = await Promise.all([repo.listUsers(this.required), repo.memberActivity(this.required, now)]);
    return users.map((u) => ({ ...u, ...(activity.get(u.id) ?? { login: null, lastLoginAt: null, activeSessions: 0 }) }));
  }

  /** IB-035 — one invite for the bot's `/invite` and the site's button alike. */
  async issueInvite(createdBy: number, now = new Date(), ttlMs?: number): Promise<Invite> {
    const { code, expiresAt } = newInvite(now, ttlMs);
    return repo.createInvite(this.required, code, createdBy, expiresAt);
  }

  /**
   * IB-035 — disable or enable a member, in ONE transaction. Disabling also deletes every web
   * session of theirs, so an open tab is signed out at its next request; the bot already answers a
   * disabled user as a stranger. Enabling only clears the flag: the password stays as it was.
   */
  async setDisabled(actor: User, targetId: number, disabled: boolean): Promise<
    { ok: true; user: User; sessionsDeleted: number } | { ok: false; reason: WebMemberRefusal | 'NOT_FOUND' }
  > {
    const result = await this.required.transaction(async (tx) => {
      const activeAdmins = disabled ? await repo.countActiveAdmins(tx) : 0; // locks the admin rows first
      const target = await repo.findById(tx, targetId, true);
      if (!target) return { ok: false as const, reason: 'NOT_FOUND' as const };
      if (disabled) {
        const refusal = disableRefusal(actor.id, target, activeAdmins);
        if (refusal) return { ok: false as const, reason: refusal };
      }
      await repo.setDisabled(tx, targetId, disabled);
      const sessionsDeleted = disabled ? await deleteSessionsForUser(tx, targetId) : 0;
      return { ok: true as const, user: { ...target, disabled }, sessionsDeleted };
    });
    if (result.ok) {
      this.logger.log(`admin ${actor.id} ${disabled ? 'disabled' : 'enabled'} user ${targetId}${disabled ? ` (${result.sessionsDeleted} web session(s) ended)` : ''}`);
    }
    return result;
  }
}

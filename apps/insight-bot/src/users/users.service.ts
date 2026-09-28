import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
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
}

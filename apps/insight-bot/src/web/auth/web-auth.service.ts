import { Inject, Injectable, Logger } from '@nestjs/common';
import { clientIpHeaderName } from '../../config/client-ip-header';
import { AppConfigService } from '../../config/config.service';
import { DB, type Db } from '../../db/db.port';
import type { User } from '../../users/user.model';
import * as repo from './pg/auth.repo';
import { newOpaqueToken, SESSION_TTL_MS, sha256Hex, shouldRefreshSession } from './session-cookie';

export type OpenedSession = { ok: true; user: User; token: string; expiresAtMs: number };

/**
 * IB-029 — dashboard sessions (architecture/insight-bot-web-dashboard.md §4). Since IB-078 a session
 * is opened only by a login + password (`CredentialsService.login`); the link exchange (IB-029) and
 * the Telegram widget (IB-072) are gone (password-login design P11).
 *
 * The plaintext session token exists only in the browser's cookie; everything stored is its sha256.
 */
@Injectable()
export class WebAuthService {
  private readonly logger = new Logger(WebAuthService.name);

  constructor(
    @Inject(DB) private readonly db: Db | null,
    private readonly config: AppConfigService,
  ) {}

  private get required(): Db {
    if (!this.db) throw new Error('WebAuthService: no database. Set DATABASE_URL.');
    return this.db;
  }

  /** Whether the dashboard is configured at all; `/web` refuses when it is not (§4). */
  get webBaseUrl(): string | null {
    const url = this.config.env.get('WEB_BASE_URL');
    return typeof url === 'string' && url.length > 0 ? url : null;
  }

  /** `TELEGRAM_BOT_USERNAME` — public, and the login screen needs it (IB-BUG-008). */
  get botUsername(): string {
    return this.config.env.get('TELEGRAM_BOT_USERNAME');
  }

  /** IB-078 H6: the header the client IP is read from (`x-real-ip` on the box), or unset = the socket. */
  get clientIpHeader(): string | undefined {
    return clientIpHeaderName(this.config.env.get('CLIENT_IP_HEADER'));
  }

  get cookieSecure(): boolean {
    return this.config.env.get('WEB_COOKIE_SECURE') === true;
  }

  /**
   * The one place a session is minted (IB-078: only after a correct password). Re-reads the row
   * through the same join `resolveSession` uses, so a member disabled between the check and the
   * insert never walks away with a cookie. Null = refused (disabled).
   */
  async openSession(userId: number, now: Date): Promise<OpenedSession | null> {
    const sessionToken = newOpaqueToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await repo.createSession(this.required, sha256Hex(sessionToken), userId, expiresAt);

    const opened = await repo.findLiveSession(this.required, sha256Hex(sessionToken), now);
    if (!opened || opened.user.disabled) {
      if (opened) await repo.deleteSession(this.required, opened.session.id);
      return null;
    }
    return { ok: true, user: opened.user, token: sessionToken, expiresAtMs: expiresAt.getTime() };
  }

  /**
   * Resolves a cookie to its member, sliding the window when the row is over an hour stale.
   * A disabled member's session is deleted on sight rather than merely refused.
   */
  async resolveSession(token: string, now = new Date()): Promise<{ user: User; refreshedExpiresAtMs?: number } | null> {
    const id = sha256Hex(token);
    const found = await repo.findLiveSession(this.required, id, now);
    if (!found) return null;

    if (found.user.disabled) {
      await repo.deleteSessionsForUser(this.required, found.user.id);
      return null;
    }

    if (!shouldRefreshSession(found.session.lastSeenAt.getTime(), now.getTime())) {
      return { user: found.user };
    }
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await repo.touchSession(this.required, id, now, expiresAt);
    return { user: found.user, refreshedExpiresAtMs: expiresAt.getTime() };
  }

  async logout(token: string): Promise<void> {
    await repo.deleteSession(this.required, sha256Hex(token));
  }

  /** §4: disabling a member deletes their sessions. */
  async revokeUser(userId: number): Promise<number> {
    const n = await repo.deleteSessionsForUser(this.required, userId);
    if (n > 0) this.logger.log(`revoked ${n} dashboard session(s) for user ${userId}`);
    return n;
  }
}

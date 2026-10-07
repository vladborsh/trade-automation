import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WebAuthErrorCode } from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { DB, type Db } from '../../db/db.port';
import type { User } from '../../users/user.model';
import * as repo from './pg/auth.repo';
import {
  LOGIN_TOKEN_TTL_MS, newOpaqueToken, SESSION_TTL_MS, sha256Hex, shouldRefreshSession, loginUrl,
} from './session-cookie';

export type ExchangeOutcome =
  | { ok: true; user: User; token: string; expiresAtMs: number }
  | { ok: false; code: Extract<WebAuthErrorCode, 'TOKEN_INVALID' | 'TOKEN_USED' | 'TOKEN_EXPIRED'>; status: 401 | 410 };

/**
 * IB-029 — issuing login links and turning them into sessions
 * (architecture/insight-bot-web-dashboard.md §1 W3, §4).
 *
 * The plaintext token exists in exactly two places and never in the database: the Telegram
 * message, and the browser's cookie. Everything stored is `sha256(token)`.
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

  get cookieSecure(): boolean {
    return this.config.env.get('WEB_COOKIE_SECURE') === true;
  }

  /**
   * Creates a one-time login link for a member. Returns the full URL — the caller (the bot)
   * sends it and then forgets it; we keep only the hash.
   */
  async createLoginLink(userId: number, now = new Date()): Promise<string | null> {
    const base = this.webBaseUrl;
    if (!base) return null;
    const token = newOpaqueToken();
    const expiresAt = new Date(now.getTime() + LOGIN_TOKEN_TTL_MS);
    await repo.createLoginToken(this.required, sha256Hex(token), userId, expiresAt);
    return loginUrl(base, token);
  }

  /**
   * Spends a login token and opens a session.
   *
   * A disabled member is refused as `TOKEN_INVALID`, not as "disabled": the token is consumed
   * either way, and someone whose access was revoked should not learn from the dashboard that
   * their account still exists.
   */
  async exchange(token: string, now = new Date()): Promise<ExchangeOutcome> {
    const claim = await repo.consumeLoginToken(this.required, sha256Hex(token), now);
    if (claim.kind === 'unknown') return { ok: false, code: 'TOKEN_INVALID', status: 401 };
    if (claim.kind === 'used') return { ok: false, code: 'TOKEN_USED', status: 410 };
    if (claim.kind === 'expired') return { ok: false, code: 'TOKEN_EXPIRED', status: 410 };

    const sessionToken = newOpaqueToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await repo.createSession(this.required, sha256Hex(sessionToken), claim.userId as number, expiresAt);

    const opened = await repo.findLiveSession(this.required, sha256Hex(sessionToken), now);
    if (!opened || opened.user.disabled) {
      if (opened) await repo.deleteSession(this.required, opened.session.id);
      return { ok: false, code: 'TOKEN_INVALID', status: 401 };
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

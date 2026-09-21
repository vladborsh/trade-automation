import { HttpStatus, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InviteInfo, User } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { apiError } from './auth-error';
import { AUTH_REPOSITORIES, AuthRepositories } from './auth-repositories.port';
import { AuthSessionRepository } from './auth-session.repository.port';
import { InviteRepository } from './invite.repository.port';
import { inviteStatus } from './invite-status';
import { LoginThrottle } from './login-throttle';
import { PasswordHasher } from './password';
import {
  SESSION_TTL_MS,
  newOpaqueToken,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  sha256Hex,
  shouldRefreshSession,
} from './session-cookie';
import { EmailTakenError, UserRecord } from './user.repository.port';

export type Clock = () => number;
export const AUTH_CLOCK = Symbol('AUTH_CLOCK');

/** A freshly created `auth_sessions` row: the raw token goes into the cookie, never into the DB. */
export interface IssuedSession {
  user: User;
  token: string;
  expiresAtMs: number;
}

export interface Authenticated {
  user: User;
  /** Set when this request slid the session's expiry forward; the cookie must be re-sent. */
  refreshedExpiresAtMs: number | null;
}

/** `invites.expires_at = created_at + 7 days` (§3); the admin endpoint that creates invites uses this. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toWireUser(user: UserRecord): User {
  return { id: user.id, email: user.email, role: user.role };
}

/**
 * architecture/backtest-app-system-design.md §7.1, D7 — login/logout/me/invite accept. With no
 * `DATABASE_URL` the repositories resolve to null, `enabled` is false, every method here answers
 * 503 and `AuthGuard` lets every request through (documented dev/mock behaviour, §2.2).
 */
@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(AUTH_REPOSITORIES) private readonly repos: AuthRepositories | null,
    private readonly hasher: PasswordHasher,
    private readonly throttle: LoginThrottle,
    private readonly config: AppConfigService,
    @Inject(AUTH_CLOCK) private readonly now: Clock,
  ) {}

  get enabled(): boolean {
    return this.repos !== null;
  }

  async login(email: string, password: string, userAgent: string | null): Promise<IssuedSession> {
    const repos = this.requireEnabled();
    const now = this.now();
    if (this.throttle.isBlocked(email, now)) {
      throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_ATTEMPTS', 'Too many failed login attempts; try again later.');
    }

    const user = await repos.users.findByEmail(email);
    // An unknown email still pays for one scrypt, so response time does not reveal which emails exist.
    const ok = await this.hasher.verify(password, user?.passwordHash ?? (await this.dummyPasswordHash()));
    if (!user || !ok) {
      this.throttle.recordFailure(email, now);
      throw apiError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    if (user.disabledAtMs !== null) {
      throw apiError(HttpStatus.FORBIDDEN, 'USER_DISABLED', 'This account is disabled.');
    }

    this.throttle.reset(email);
    await repos.sessions.deleteExpiredForUser(user.id, now);
    return this.issueSession(repos.sessions, user, userAgent, now);
  }

  async logout(token: string): Promise<void> {
    await this.requireEnabled().sessions.delete(sha256Hex(token));
  }

  /** Resolves a `bt_session` token to its user, sliding the expiry when due; null when invalid. */
  async authenticate(token: string): Promise<Authenticated | null> {
    const repos = this.requireEnabled();
    const now = this.now();
    const session = await repos.sessions.findWithUser(sha256Hex(token));
    if (!session) return null;
    if (session.expiresAtMs <= now) {
      await repos.sessions.delete(session.id);
      return null;
    }
    if (session.user.disabledAtMs !== null) return null;

    if (!shouldRefreshSession(session.lastSeenAtMs, now)) {
      return { user: toWireUser(session.user), refreshedExpiresAtMs: null };
    }
    const expiresAtMs = now + SESSION_TTL_MS;
    await repos.sessions.touch(session.id, now, expiresAtMs);
    return { user: toWireUser(session.user), refreshedExpiresAtMs: expiresAtMs };
  }

  async inviteInfo(token: string): Promise<InviteInfo> {
    const repos = this.requireEnabled();
    const invite = await repos.invites.findByTokenHash(sha256Hex(token));
    const status = inviteStatus(invite, this.now());
    if (status !== 'valid' || !invite) throw inviteError(status);
    return { email: invite.email, expiresAt: invite.expiresAtMs };
  }

  /**
   * §7.1 — one transaction: claim the invite with the conditional UPDATE (the single-use gate),
   * create the user, record `used_by`, open a session. The claim comes first so that of N
   * concurrent accepts exactly one proceeds and the rest see `INVITE_USED`, whatever emails they
   * sent; a lost claim or a taken email rolls the whole transaction back.
   */
  async acceptInvite(token: string, email: string, password: string, userAgent: string | null): Promise<IssuedSession> {
    const repos = this.requireEnabled();
    const tokenHash = sha256Hex(token);
    const passwordHash = await this.hasher.hash(password); // outside the transaction: no lock held during scrypt
    const now = this.now();
    try {
      return await repos.transaction(async (tx) => {
        const inviteId = await tx.invites.claim(tokenHash, now);
        if (!inviteId) throw inviteError(await this.unavailableStatus(tx.invites, tokenHash, now));
        const user = await tx.users.insert({ email, passwordHash, role: 'user' });
        await tx.invites.setUsedBy(inviteId, user.id);
        return this.issueSession(tx.sessions, user, userAgent, now);
      });
    } catch (err) {
      if (err instanceof EmailTakenError) {
        throw apiError(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'An account with this email already exists.');
      }
      throw err;
    }
  }

  sessionCookie(session: { token: string; expiresAtMs: number }): string {
    return serializeSessionCookie(session.token, session.expiresAtMs, this.cookieOptions());
  }

  clearedSessionCookie(): string {
    return serializeClearedSessionCookie(this.cookieOptions());
  }

  private cookieOptions() {
    return { secure: Boolean(this.config.env.get('SESSION_COOKIE_SECURE')) };
  }

  private async issueSession(
    sessions: AuthSessionRepository,
    user: UserRecord,
    userAgent: string | null,
    now: number,
  ): Promise<IssuedSession> {
    const token = newOpaqueToken();
    const expiresAtMs = now + SESSION_TTL_MS;
    await sessions.insert({ id: sha256Hex(token), userId: user.id, expiresAtMs, nowMs: now, userAgent });
    return { user: toWireUser(user), token, expiresAtMs };
  }

  private async unavailableStatus(invites: InviteRepository, tokenHash: string, now: number) {
    const status = inviteStatus(await invites.findByTokenHash(tokenHash), now);
    // 'valid' here means the claim lost a race that has since been undone; report it as used.
    return status === 'valid' ? 'used' : status;
  }

  private dummyPasswordHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash(newOpaqueToken());
    return this.dummyHash;
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

function inviteError(status: 'unknown' | 'used' | 'expired' | 'valid') {
  if (status === 'unknown') return apiError(HttpStatus.NOT_FOUND, 'INVITE_UNKNOWN', 'Unknown invite.');
  if (status === 'expired') return apiError(HttpStatus.GONE, 'INVITE_EXPIRED', 'This invite has expired.');
  return apiError(HttpStatus.GONE, 'INVITE_USED', 'This invite has already been used.');
}

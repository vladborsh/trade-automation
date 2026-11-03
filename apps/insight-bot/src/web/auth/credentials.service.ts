import { Inject, Injectable, Logger } from '@nestjs/common';
import { WEB_LOGIN_EVENTS_MAX_LIMIT, type WebAuthErrorCode, type WebLoginOutcome } from '@trade-automation/contracts';
import { DB, type Db, type DbHandle } from '../../db/db.port';
import type { User } from '../../users/user.model';
import * as authRepo from './pg/auth.repo';
import * as repo from './pg/credentials.repo';
import { isAcceptablePassword, isValidLogin, normalizeLogin } from './credential-rules';
import { LoginGuard } from './login-throttle';
import { PasswordHasher } from './password';
import { credentialsUrl, LOGIN_TOKEN_TTL_MS, newOpaqueToken, sha256Hex } from './session-cookie';
import { WebAuthService } from './web-auth.service';

/**
 * Verified against when the login does not exist, so an unknown login costs exactly one scrypt,
 * like a wrong password does (P7): the response time does not say which logins exist. It is a hash
 * of 32 random bytes nobody kept — no password matches it.
 */
export const DUMMY_PASSWORD_HASH = 'scrypt$32768$8$1$m7qycVGM0-c-WBKZbwnFkQ$_IMm_sFzAy01ZDtSKpVfZu7Y_dTUhijhhERTIUgr5Eo';

/** Who is asking, for the throttle's IP key and the journal. Never a password. */
export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}

type Fail<C extends WebAuthErrorCode, S extends number> = { ok: false; code: C; status: S };
type TokenFail = Fail<'TOKEN_INVALID', 401> | Fail<'TOKEN_USED' | 'TOKEN_EXPIRED', 410>;

export type LoginOutcome =
  | { ok: true; user: User; login: string; token: string; expiresAtMs: number }
  | Fail<'INVALID_CREDENTIALS', 401>
  | Fail<'TOO_MANY_ATTEMPTS', 429>;

export type CredentialsInfo = { ok: true; hasLogin: boolean; login?: string } | TokenFail;

export type SetCredentialsOutcome =
  | { ok: true; created: boolean }
  | TokenFail
  | Fail<'LOGIN_TAKEN', 409>
  | Fail<'BAD_LOGIN' | 'WEAK_PASSWORD', 422>;

export type ChangePasswordOutcome =
  | { ok: true }
  | Fail<'INVALID_CREDENTIALS', 401>
  | Fail<'TOO_MANY_ATTEMPTS', 429>
  | Fail<'WEAK_PASSWORD', 422>;

const INVALID: Fail<'INVALID_CREDENTIALS', 401> = { ok: false, code: 'INVALID_CREDENTIALS', status: 401 };
const THROTTLED: Fail<'TOO_MANY_ATTEMPTS', 429> = { ok: false, code: 'TOO_MANY_ATTEMPTS', status: 429 };

function tokenFail(kind: authRepo.LoginTokenClaim['kind']): TokenFail {
  if (kind === 'used') return { ok: false, code: 'TOKEN_USED', status: 410 };
  if (kind === 'expired') return { ok: false, code: 'TOKEN_EXPIRED', status: 410 };
  return { ok: false, code: 'TOKEN_INVALID', status: 401 };
}

/** What the journal may keep of the login field: nothing, when it holds the submitted password. */
export function journalSafeLogin(rawLogin: string, password: string): string | null {
  if (password.length > 0 && rawLogin.includes(password)) return null;
  return rawLogin;
}

/** Thrown inside the save transaction to roll the token consumption back with it. */
class TokenRace extends Error {
  constructor(readonly kind: authRepo.LoginTokenClaim['kind']) {
    super(kind);
  }
}

/**
 * IB-078 — login + password (architecture/password-login-design-2026-11-02.md P1–P10).
 *
 * **The password goes into exactly two calls: `hasher.hash` and `hasher.verify`.** It is never in a
 * log line, an error message or a journal row, and no field of the journal can hold it except
 * `login_attempted` when someone types it into the login box — which is why the journal is admin-only.
 */
@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    @Inject(DB) private readonly db: Db | null,
    private readonly auth: WebAuthService,
    private readonly hasher: PasswordHasher,
    private readonly guard: LoginGuard,
  ) {}

  private get required(): Db {
    if (!this.db) throw new Error('CredentialsService: no database. Set DATABASE_URL.');
    return this.db;
  }

  // -------------------------------------------------------------------------------------------
  // issuing links (the bot)
  // -------------------------------------------------------------------------------------------

  /**
   * P1–P3: a one-time CREDENTIALS link — sets up or resets the password, never opens a session.
   * Deletes the member's unused links first, so only the newest one works. Null when WEB_BASE_URL is
   * unset (the bot then says the site is not configured, as `/web` used to).
   */
  async createCredentialsLink(userId: number, now = new Date()): Promise<string | null> {
    const base = this.auth.webBaseUrl;
    if (!base) return null;
    const token = newOpaqueToken();
    const expiresAt = new Date(now.getTime() + LOGIN_TOKEN_TTL_MS);
    await this.required.transaction(async (tx) => {
      await repo.deleteUnusedTokensForUser(tx, userId);
      await authRepo.createLoginToken(tx, sha256Hex(token), userId, expiresAt);
    });
    return credentialsUrl(base, token);
  }

  async hasCredentials(userId: number): Promise<boolean> {
    return (await repo.findCredentialsByUser(this.required, userId)) !== null;
  }

  async loginOf(userId: number): Promise<string | null> {
    return (await repo.findCredentialsByUser(this.required, userId))?.login ?? null;
  }

  // -------------------------------------------------------------------------------------------
  // POST /auth/login
  // -------------------------------------------------------------------------------------------

  /**
   * P7. The reservation comes BEFORE any scrypt (BUG-005), on both keys. An unknown login, a wrong
   * password and a disabled account are one answer, and each runs exactly one scrypt.
   */
  async login(rawLogin: string, password: string, meta: RequestMeta, now = new Date()): Promise<LoginOutcome> {
    const login = normalizeLogin(rawLogin);
    // P10: "not even when the login field holds it" — a password typed into BOTH boxes (or pasted
    // into the login box as well) must not reach the journal through `login_attempted`
    const attempted = journalSafeLogin(rawLogin, password);
    const reservation = this.guard.tryReserve(login, meta.ip, now.getTime());
    if (!reservation) {
      await this.journal({ userId: null, loginAttempted: attempted, outcome: 'throttled' }, meta, now);
      return THROTTLED;
    }

    try {
      const found = await repo.findCredentialsByLogin(this.required, login);
      const matches = await this.hasher.verify(password, found?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!found || !matches || found.disabled) {
        // the reservation stays: it IS the failure
        await this.journal({ userId: found?.userId ?? null, loginAttempted: attempted, outcome: 'bad_credentials' }, meta, now);
        return INVALID;
      }

      const opened = await this.auth.openSession(found.userId, now);
      if (!opened) {
        // disabled between the check and the insert: still the one generic answer
        await this.journal({ userId: found.userId, loginAttempted: attempted, outcome: 'bad_credentials' }, meta, now);
        return INVALID;
      }
      this.guard.succeeded(reservation);
      await this.journal({ userId: found.userId, loginAttempted: attempted, outcome: 'success' }, meta, now);
      return { ok: true, user: opened.user, login: found.login, token: opened.token, expiresAtMs: opened.expiresAtMs };
    } catch (error) {
      this.guard.release(reservation); // neither a success nor a wrong password
      throw error;
    }
  }

  // -------------------------------------------------------------------------------------------
  // GET / POST /auth/credentials
  // -------------------------------------------------------------------------------------------

  /** Whether the page must ask for a login. Reads the token, NEVER spends it. */
  async credentialsInfo(token: string, now = new Date()): Promise<CredentialsInfo> {
    const claim = await repo.peekLoginToken(this.required, sha256Hex(token), now);
    if (claim.kind !== 'ok') return tokenFail(claim.kind);
    if (!(await repo.isUserEnabled(this.required, claim.userId as number))) return tokenFail('unknown');
    const existing = await repo.findCredentialsByUser(this.required, claim.userId as number);
    return existing ? { ok: true, hasLogin: true, login: existing.login } : { ok: true, hasLogin: false };
  }

  /**
   * P1–P3, §3. The token is spent only when the credentials are saved: the conditional UPDATE and
   * the insert share one transaction, so a taken login (the UNIQUE constraint) rolls the consumption
   * back and the same link still works. After saving, EVERY session of the account ends and none is
   * opened — the person signs in on /login with what they just chose.
   */
  async setCredentials(
    token: string, rawLogin: string | undefined, password: string, meta: RequestMeta, now = new Date(),
  ): Promise<SetCredentialsOutcome> {
    const tokenHash = sha256Hex(token);
    const claim = await repo.peekLoginToken(this.required, tokenHash, now);
    if (claim.kind !== 'ok') return tokenFail(claim.kind);
    const userId = claim.userId as number;
    if (!(await repo.isUserEnabled(this.required, userId))) return tokenFail('unknown');

    // a reset keeps the login: `login` is ignored when the account has one
    const existing = await repo.findCredentialsByUser(this.required, userId);
    const login = existing ? existing.login : normalizeLogin(rawLogin ?? '');
    if (!existing && !isValidLogin(login)) return { ok: false, code: 'BAD_LOGIN', status: 422 };
    if (!isAcceptablePassword(password, login)) return { ok: false, code: 'WEAK_PASSWORD', status: 422 };

    const hash = await this.hasher.hash(password); // outside the transaction: 32 MiB, ~100 ms
    try {
      const saved = await this.required.transaction(async (tx) => {
        const consumed = await authRepo.consumeLoginToken(tx, tokenHash, now);
        if (consumed.kind !== 'ok') throw new TokenRace(consumed.kind);
        const result = await repo.saveCredentials(tx, userId, login, hash, now);
        await repo.deleteAllSessions(tx, userId);
        await this.journalOn(tx, {
          userId, loginAttempted: result.login, outcome: result.created ? 'password_set' : 'password_reset',
        }, meta, now);
        return result;
      });
      return { ok: true, created: saved.created };
    } catch (error) {
      if (error instanceof repo.LoginTakenError) return { ok: false, code: 'LOGIN_TAKEN', status: 409 };
      if (error instanceof TokenRace) return tokenFail(error.kind);
      throw error;
    }
  }

  // -------------------------------------------------------------------------------------------
  // POST /auth/password, POST /auth/logout-all
  // -------------------------------------------------------------------------------------------

  /** P9: change while signed in. Throttled like login; ends every OTHER session, keeps this one. */
  async changePassword(
    user: User, sessionId: string, current: string, next: string, meta: RequestMeta, now = new Date(),
  ): Promise<ChangePasswordOutcome> {
    const existing = await repo.findCredentialsByUser(this.required, user.id);
    const key = existing?.login ?? `user:${user.id}`;
    const reservation = this.guard.tryReserve(key, meta.ip, now.getTime());
    if (!reservation) {
      await this.journal({ userId: user.id, loginAttempted: existing?.login ?? null, outcome: 'throttled' }, meta, now);
      return THROTTLED;
    }
    try {
      const matches = await this.hasher.verify(current, existing?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!existing || !matches) {
        await this.journal({ userId: user.id, loginAttempted: existing?.login ?? null, outcome: 'bad_credentials' }, meta, now);
        return INVALID;
      }
      if (!isAcceptablePassword(next, existing.login)) {
        this.guard.release(reservation); // the current password was right: not a failure
        return { ok: false, code: 'WEAK_PASSWORD', status: 422 };
      }
      const hash = await this.hasher.hash(next);
      await this.required.transaction(async (tx) => {
        await repo.updatePasswordHash(tx, user.id, hash, now);
        await repo.deleteOtherSessions(tx, user.id, sessionId);
        await this.journalOn(tx, { userId: user.id, loginAttempted: existing.login, outcome: 'password_changed' }, meta, now);
      });
      this.guard.succeeded(reservation);
      return { ok: true };
    } catch (error) {
      this.guard.release(reservation);
      throw error;
    }
  }

  /** P9: every session of the member, this one included. */
  async logoutAll(user: User, meta: RequestMeta, now = new Date()): Promise<void> {
    await this.auth.revokeUser(user.id);
    await this.journal({ userId: user.id, loginAttempted: await this.loginOf(user.id), outcome: 'logout_all' }, meta, now);
  }

  async loginEvents(limit: number): Promise<repo.LoginEventRow[]> {
    const bounded = Math.max(1, Math.min(WEB_LOGIN_EVENTS_MAX_LIMIT, Math.floor(limit)));
    return repo.listLoginEvents(this.required, bounded);
  }

  // -------------------------------------------------------------------------------------------

  private journal(e: { userId: number | null; loginAttempted: string | null; outcome: WebLoginOutcome }, meta: RequestMeta, now: Date): Promise<void> {
    return this.journalOn(this.required, e, meta, now).catch((error: unknown) => {
      // a journal that cannot be written must not turn a login into a 500; the error says which outcome
      this.logger.error(`login journal write failed (${e.outcome}): ${(error as Error).message}`);
    });
  }

  private journalOn(
    db: DbHandle, e: { userId: number | null; loginAttempted: string | null; outcome: WebLoginOutcome }, meta: RequestMeta, now: Date,
  ): Promise<void> {
    return repo.recordLoginEvent(db, { ...e, ip: meta.ip, userAgent: meta.userAgent }, now);
  }
}

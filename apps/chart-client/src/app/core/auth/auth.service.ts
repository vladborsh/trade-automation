import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { InviteInfo, User } from '@trade-automation/contracts';
import { isApiError } from '../api/api-error';
import { RestClient } from '../api/rest.client';
import { HARD_NAVIGATE } from './hard-navigate';

/**
 * backtest-app-system-design.md §2.3/§7.1 — the signed-in user, held as a signal. The session
 * itself is the httpOnly `bt_session` cookie, which the client can neither read nor write; the
 * only way to learn whether it is valid is `GET /auth/me`, probed once per app load
 * (`ensureSession`) and then kept current by login / accept-invite / logout / a 401.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly rest = inject(RestClient);
  private readonly router = inject(Router);
  private readonly hardNavigate = inject(HARD_NAVIGATE);

  private readonly current = signal<User | null>(null);
  private probe: Promise<User | null> | null = null;

  readonly user = this.current.asReadonly();
  readonly isAdmin = computed(() => this.current()?.role === 'admin');

  /**
   * The user behind the session cookie, or null. Calls `GET /auth/me` at most once per app
   * load; a 401 is a definitive "signed out", while a network/server failure is not cached,
   * so the next navigation asks again.
   */
  ensureSession(): Promise<User | null> {
    this.probe ??= this.rest.getMe().then(
      ({ user }) => {
        this.current.set(user);
        return user;
      },
      (err: unknown) => {
        if (!isApiError(err, 401)) {
          this.probe = null;
        }
        return null;
      },
    );
    return this.probe;
  }

  /** Rejects with the server's ApiError (INVALID_CREDENTIALS, USER_DISABLED, TOO_MANY_ATTEMPTS). */
  async login(email: string, password: string): Promise<User> {
    const { user } = await this.rest.login({ email, password });
    this.setUser(user);
    return user;
  }

  /** Rejects with 404 INVITE_UNKNOWN or 410 INVITE_USED / INVITE_EXPIRED. */
  getInvite(token: string): Promise<InviteInfo> {
    return this.rest.getInvite(token);
  }

  /** Sets the password on an invite and signs the new user in (the server sets the cookie). */
  async acceptInvite(token: string, email: string, password: string): Promise<User> {
    const { user } = await this.rest.acceptInvite(token, { email, password });
    this.setUser(user);
    return user;
  }

  /** Ends the session server-side (best effort) and reloads the app at /login. */
  async logout(): Promise<void> {
    try {
      await this.rest.logout();
    } catch {
      // Already expired or the server is unreachable: signing out locally is still correct.
    }
    this.setUser(null);
    this.hardNavigate('/login');
  }

  /** A data request came back 401: the session is gone. Back to /login, remembering where we were. */
  handleUnauthorized(): void {
    this.setUser(null);
    const here = this.router.url;
    if (here === '/login' || here.startsWith('/login?') || here.startsWith('/invite/')) {
      return;
    }
    void this.router.navigate(['/login'], { queryParams: { returnUrl: here } });
  }

  private setUser(user: User | null): void {
    this.current.set(user);
    this.probe = Promise.resolve(user);
  }
}

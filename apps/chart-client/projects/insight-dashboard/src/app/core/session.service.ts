import { computed, inject, Injectable, signal } from '@angular/core';
import type { WebUser } from '@trade-automation/contracts';
import { InsightApiClient } from './insight-api.client';
import { isAdmin, sessionUser } from './session-user';

/**
 * IB-075 — who is signed in, from `/auth/me`, shared by the shell (the nav link), the language
 * initializer and the admin route guard, so the dashboard asks once rather than once per caller.
 *
 * A known member is kept; an unknown one (no session yet) is asked again on the next `ensure()`,
 * which is how a login — that happens on /login, outside this service — becomes visible to the nav.
 * The server still decides every request (`/api/web/health/*` answers 403 to a member); this only
 * shapes what the page offers.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(InsightApiClient);
  private readonly current = signal<WebUser | null>(null);
  private inflight: Promise<WebUser | null> | null = null;

  readonly user = this.current.asReadonly();
  readonly isAdmin = computed(() => isAdmin(this.current()));

  /** The signed-in member, or null; asks the server only while none is known. */
  ensure(): Promise<WebUser | null> {
    const known = this.current();
    if (known !== null) return Promise.resolve(known);
    this.inflight ??= this.api
      .me()
      .then((body) => sessionUser(body))
      .catch(() => null)
      .then((user) => {
        this.current.set(user);
        this.inflight = null;
        return user;
      });
    return this.inflight;
  }
}

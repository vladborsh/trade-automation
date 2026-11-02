import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { isAdmin } from './session-user';
import { SessionService } from './session.service';

/**
 * IB-075 (member-access design M8) — a route only an admin opens. Anyone else is sent to
 * `fallback` (the landing page), not shown an error: a member who types /health simply lands on
 * the market. The server enforces the same rule on its own (403 on `/api/web/health/*`); this
 * guard only keeps a member from a page whose every request would be refused.
 *
 * `fallback` is a parameter, not an import of `LANDING_ROUTE`, because app.routes.ts imports this
 * file — reading it back would be a module cycle.
 */
export function adminGuard(fallback: string): CanActivateFn {
  return async () => {
    // inject() only works before the first await
    const router = inject(Router);
    const session = inject(SessionService);
    return isAdmin(await session.ensure()) ? true : router.parseUrl(fallback);
  };
}

import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { DEFAULT_AUTHED_URL } from './return-url';

// Each guard injects before its first `await` — the injection context does not survive it.

/** §2.3 — every non-public route: signed in, or off to /login with the way back remembered. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ensureSession();
  return user ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** §2.3 — `/admin/*`: signed in (already checked by authGuard on the parent) and role admin. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ensureSession();
  return user?.role === 'admin' ? true : router.parseUrl(DEFAULT_AUTHED_URL);
};

/** `/login`: an already signed-in user has nothing to do there. */
export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ensureSession();
  return user ? router.parseUrl(DEFAULT_AUTHED_URL) : true;
};

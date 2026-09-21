import { InjectionToken } from '@angular/core';

/**
 * Called by RestClient when a data request comes back 401 (the session expired or was never
 * there). app.config.ts provides the real one — clear the user and go to /login; the default
 * is a no-op so RestClient stays constructible without the auth layer (tests, tools).
 */
export const UNAUTHORIZED_HANDLER = new InjectionToken<() => void>('UNAUTHORIZED_HANDLER', {
  providedIn: 'root',
  factory: () => () => undefined,
});

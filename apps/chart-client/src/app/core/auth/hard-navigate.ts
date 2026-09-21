import { InjectionToken } from '@angular/core';

/**
 * A full page load of `url`. Logout uses it instead of a router navigation so that nothing of
 * the previous user survives in memory — root stores, feeds and the open WebSocket are all
 * torn down with the page. A token so specs can observe it without leaving the test page.
 */
export const HARD_NAVIGATE = new InjectionToken<(url: string) => void>('HARD_NAVIGATE', {
  providedIn: 'root',
  factory: () => (url: string) => window.location.assign(url),
});

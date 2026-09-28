import { Routes } from '@angular/router';

/**
 * architecture/insight-bot-web-dashboard.md §3.
 *
 * **A member lands on insights, never on diagnostics.** The user logged in twice expecting market
 * data and met the data-collector's page, because that was the landing route and the instrument
 * view — already merged and working — had no menu entry at all.
 *
 * `LANDING_ROUTE` is the single place that decides where "in" is: the default route, the unknown-path
 * fallback and the login exchange all read it, so moving the landing page is one edit rather than
 * three that can disagree. IB-037's card page has landed, so it is `/market`.
 */

/** Where a member arrives: the market cards, never Health. */
export const LANDING_ROUTE = '/market';

/** The same destination as a `redirectTo`, which takes no leading slash. */
const LANDING_REDIRECT = LANDING_ROUTE.replace(/^\//, '');
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: LANDING_REDIRECT },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'health',
    loadComponent: () => import('./features/health/health.component').then((m) => m.HealthComponent),
  },
  {
    path: 'coverage',
    loadComponent: () => import('./features/coverage/coverage.component').then((m) => m.CoverageComponent),
  },
  {
    path: 'instrument/:symbol',
    loadComponent: () => import('./features/instrument/instrument.component').then((m) => m.InstrumentComponent),
  },
  {
    path: 'market',
    loadComponent: () => import('./features/market/market.component').then((m) => m.MarketComponent),
  },
  { path: '**', redirectTo: LANDING_REDIRECT },
];

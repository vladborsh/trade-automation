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
 * three that can disagree. It becomes `/market` when IB-037's page lands.
 */

/** Where a member arrives: the most useful page we have, never Health. */
export const LANDING_ROUTE = '/instrument/BTCUSDT';

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
  // IB-038's placeholder, NOT the market page. IB-037 replaces this entry with its own page and
  // mounts the three liquidation components under its cards; dev-1 resolves the conflict in
  // favour of their version (reports/dev-1-IB-037-038-seam.md). Until then this is the only way
  // to reach the liquidation surfaces by clicking, which is what their acceptance needs.
  {
    path: 'market',
    loadComponent: () => import('./features/liquidations/liquidations-page.component').then((m) => m.LiquidationsPageComponent),
  },
  { path: '**', redirectTo: LANDING_REDIRECT },
];

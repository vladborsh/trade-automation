import { Routes } from '@angular/router';
import { adminGuard } from './core/admin.guard';

/**
 * architecture/insight-bot-web-dashboard.md §3.
 *
 * **A member lands on insights, never on diagnostics.** The user logged in twice expecting market
 * data and met the data-collector's page, because that was the landing route and the instrument
 * view — already merged and working — had no menu entry at all.
 *
 * `LANDING_ROUTE` is the single place that decides where "in" is: the default route, the unknown-path
 * fallback and the login page all read it, so moving the landing page is one edit rather than
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
    // IB-079: the bot's one link (set up / reset the password). Public, like /login.
    path: 'set-password',
    loadComponent: () => import('./features/set-password/set-password.component').then((m) => m.SetPasswordComponent),
  },
  {
    path: 'account',
    loadComponent: () => import('./features/account/account.component').then((m) => m.AccountComponent),
  },
  {
    // IB-079 (password-login design P10): the login journal — admin only, IB-075's guard.
    path: 'admin/logins',
    canActivate: [adminGuard(LANDING_ROUTE)],
    loadComponent: () => import('./features/admin-logins/admin-logins.component').then((m) => m.AdminLoginsComponent),
  },
  {
    // IB-035: the members page — admin only, IB-075's guard; the server answers 403 to a member anyway
    path: 'admin/members',
    canActivate: [adminGuard(LANDING_ROUTE)],
    loadComponent: () => import('./features/admin-members/admin-members.component').then((m) => m.AdminMembersComponent),
  },
  {
    // IB-112 (OI divergence design V17): the alerts page — admin only, IB-075's guard
    path: 'admin/alerts',
    canActivate: [adminGuard(LANDING_ROUTE)],
    loadComponent: () => import('./features/admin-alerts/admin-alerts.component').then((m) => m.AdminAlertsComponent),
  },
  {
    // IB-075 (member-access design M8): the operator page is admin-only; a member lands on the market.
    path: 'health',
    canActivate: [adminGuard(LANDING_ROUTE)],
    loadComponent: () => import('./features/health/health.component').then((m) => m.HealthComponent),
  },
  {
    path: 'instrument/:symbol',
    loadComponent: () => import('./features/instrument/instrument.component').then((m) => m.InstrumentComponent),
  },
  {
    path: 'market',
    loadComponent: () => import('./features/market/market.component').then((m) => m.MarketComponent),
  },
  {
    // IB-103: positioning as a page (the Market tab keeps a compact top 5); signed in, like /market
    path: 'positioning',
    loadComponent: () => import('./features/positioning/positioning-page.component').then((m) => m.PositioningPageComponent),
  },
  {
    // IB-120 (market-round2 §4): every large liquidation, filtered — reached from Market, no nav item
    path: 'liquidations',
    loadComponent: () => import('./features/liquidations/liquidations-page.component').then((m) => m.LiquidationsPageComponent),
  },
  { path: '**', redirectTo: LANDING_REDIRECT },
];

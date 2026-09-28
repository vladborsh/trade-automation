import { Routes } from '@angular/router';

/**
 * architecture/insight-bot-web-dashboard.md §3. `/instrument/:symbol` and `/market` are reserved
 * here for IB-031 and IB-037 so the shell's navigation does not have to change when they land;
 * they resolve to the health page until then rather than 404ing on a link someone already shared.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'health' },
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
  { path: 'market', redirectTo: 'health' }, // IB-037
  { path: '**', redirectTo: 'health' },
];

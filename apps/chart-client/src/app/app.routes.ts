import type { Routes } from '@angular/router';
import { adminGuard, authGuard, signedOutGuard } from './core/auth/auth.guard';
import { LoginComponent } from './features/auth/login.component';
import { InviteAcceptComponent } from './features/auth/invite-accept.component';

/**
 * backtest-app-system-design.md §2.3 — the whole app sits behind login (brief decision 14);
 * only /login and /invite/:token are public. /sessions is the default route. The signed-in
 * pages are lazy chunks, so the login page does not download the chart terminal.
 */
export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [signedOutGuard], title: 'Sign in' },
  { path: 'invite/:token', component: InviteAcceptComponent, title: 'Accept invite' },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'sessions' },
      {
        path: 'terminal',
        loadComponent: () => import('./features/terminal/terminal-shell.component').then((m) => m.TerminalShellComponent),
        title: 'Terminal',
      },
      {
        path: 'sessions',
        loadComponent: () => import('./features/sessions/session-list.component').then((m) => m.SessionListComponent),
        title: 'Sessions',
      },
      {
        path: 'sessions/new',
        loadComponent: () => import('./features/sessions/session-create.component').then((m) => m.SessionCreateComponent),
        title: 'New session',
      },
      {
        path: 'sessions/:id/trades/:orderId',
        loadComponent: () => import('./features/backtest/trade-detail.component').then((m) => m.TradeDetailComponent),
        title: 'Trade',
      },
      {
        path: 'sessions/:id',
        loadComponent: () => import('./features/backtest/workspace.component').then((m) => m.WorkspaceComponent),
        title: 'Backtest',
      },
      {
        path: 'admin/users',
        loadComponent: () => import('./features/admin/users.component').then((m) => m.UsersComponent),
        canActivate: [adminGuard],
        title: 'Users',
      },
    ],
  },
  { path: '**', redirectTo: 'sessions' },
];

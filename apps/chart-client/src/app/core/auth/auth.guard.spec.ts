import { vi } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { User } from '@trade-automation/contracts';
import { adminGuard, authGuard, signedOutGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Component({ selector: 'app-stub', template: '' })
class StubComponent {}

const USER: User = { id: '00000000-0000-4000-8000-000000000003', email: 'u@example.com', role: 'user' };
const ADMIN: User = { ...USER, role: 'admin' };

async function navigateAs(user: User | null, url: string): Promise<string> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'login', component: StubComponent, canActivate: [signedOutGuard] },
        {
          path: '',
          canActivateChild: [authGuard],
          children: [
            { path: 'sessions', component: StubComponent },
            { path: 'terminal', component: StubComponent },
            { path: 'admin/users', component: StubComponent, canActivate: [adminGuard] },
          ],
        },
      ]),
      { provide: AuthService, useValue: { ensureSession: vi.fn().mockResolvedValue(user) } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return TestBed.inject(Router).url;
}

describe('auth guards (backtest-app-system-design.md §2.3)', () => {
  it('sends a signed-out user to /login, remembering the way back', async () => {
    expect(await navigateAs(null, '/terminal')).toBe('/login?returnUrl=%2Fterminal');
  });

  it('lets a signed-in user through', async () => {
    expect(await navigateAs(USER, '/terminal')).toBe('/terminal');
  });

  it('keeps a non-admin out of /admin/users', async () => {
    expect(await navigateAs(USER, '/admin/users')).toBe('/sessions');
    expect(await navigateAs(ADMIN, '/admin/users')).toBe('/admin/users');
  });

  it('bounces a signed-in user off /login to the default route', async () => {
    expect(await navigateAs(USER, '/login')).toBe('/sessions');
    expect(await navigateAs(null, '/login')).toBe('/login');
  });
});

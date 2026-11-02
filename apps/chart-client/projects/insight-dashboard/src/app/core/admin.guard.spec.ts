import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import type { WebUser } from '@trade-automation/contracts';
import { adminGuard } from './admin.guard';
import { SessionService } from './session.service';

/** IB-075 — /health opens for an admin; a member or nobody is redirected to the landing page. */
async function run(user: WebUser | null): Promise<boolean | UrlTree> {
  TestBed.configureTestingModule({ providers: [{ provide: SessionService, useValue: { ensure: async () => user } }] });
  const guard = adminGuard('/market');
  return (await TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  )) as boolean | UrlTree;
}

const user = (role: 'admin' | 'member'): WebUser => ({ id: 1, tgUserId: 111, role, lang: 'en', login: null });

describe('adminGuard', () => {
  it('lets an admin in', async () => {
    expect(await run(user('admin'))).toBe(true);
  });

  it('sends a member to /market', async () => {
    const result = await run(user('member'));
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/market');
  });

  it('sends nobody (no session) to /market too — never opens the page on a missing answer', async () => {
    const result = await run(null);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/market');
  });
});

describe('the /health route', () => {
  it('carries the admin guard (a guard nobody attaches protects nothing)', async () => {
    const { routes } = await import('../app.routes');
    const health = routes.find((r) => r.path === 'health');
    expect(health?.canActivate?.length).toBe(1);
    // and it is THE admin guard: a member is redirected through it
    TestBed.configureTestingModule({ providers: [{ provide: SessionService, useValue: { ensure: async () => user('member') } }] });
    const result = await TestBed.runInInjectionContext(() =>
      (health!.canActivate![0] as ReturnType<typeof adminGuard>)({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/market');
  });
});

import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { provideRouter, Router } from '@angular/router';
import { InsightApiClient } from '../core/insight-api.client';
import { SessionService } from '../core/session.service';
import { AccountMenuComponent } from './account-menu.component';

function setup(confirmAnswer: boolean) {
  const calls: string[] = [];
  TestBed.configureTestingModule({
    imports: [AccountMenuComponent],
    providers: [
      provideRouter([]),
      { provide: InsightApiClient, useValue: { logout: async () => void calls.push('logout'), logoutAll: async () => void calls.push('logoutAll') } },
    ],
  });
  const doc = TestBed.inject(DOCUMENT);
  const confirm = vi.spyOn(doc.defaultView as Window, 'confirm').mockReturnValue(confirmAnswer);
  const router = TestBed.inject(Router);
  const navigated: string[] = [];
  vi.spyOn(router, 'navigateByUrl').mockImplementation(async (u) => { navigated.push(String(u)); return true; });
  const session = TestBed.inject(SessionService);
  session.signedIn({ id: 1, tgUserId: 111, role: 'admin', lang: 'en', login: 'owner' });
  const fixture = TestBed.createComponent(AccountMenuComponent);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, calls, navigated, session, confirm };
}

describe('AccountMenuComponent (IB-079)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the member\'s login, linking to /account', () => {
    const { fixture } = setup(true);
    const a = (fixture.nativeElement as HTMLElement).querySelector('a');
    expect(a?.textContent).toBe('owner');
    expect(a?.getAttribute('href')).toBe('/account');
  });

  it('log out: the server call, the member forgotten, then /login', async () => {
    const { cmp, calls, navigated, session } = setup(true);
    await cmp.logout();
    expect(calls).toEqual(['logout']);
    expect(session.user()).toBeNull();
    expect(navigated).toEqual(['/login']);
  });

  it('log out everywhere asks ONCE; "no" changes nothing', async () => {
    const { cmp, calls, session, confirm } = setup(false);
    await cmp.logoutAll();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    expect(session.user()?.login).toBe('owner');
  });

  it('log out everywhere, confirmed: the server call, forgotten, /login', async () => {
    const { cmp, calls, navigated, session } = setup(true);
    await cmp.logoutAll();
    expect(calls).toEqual(['logoutAll']);
    expect(session.user()).toBeNull();
    expect(navigated).toEqual(['/login']);
  });
});

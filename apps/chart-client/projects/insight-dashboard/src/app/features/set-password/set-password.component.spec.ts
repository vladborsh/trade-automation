import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ApiError } from '@backtest-core/api/api-error';
import { InsightApiClient } from '../../core/insight-api.client';
import { SetPasswordComponent } from './set-password.component';

/** IB-079 — the set-password page against a stubbed API. */
function setup(info: () => Promise<unknown>, save: (body: unknown) => Promise<void> = async () => undefined) {
  const navigated: unknown[] = [];
  const saved: unknown[] = [];
  TestBed.configureTestingModule({
    imports: [SetPasswordComponent],
    providers: [
      { provide: InsightApiClient, useValue: { credentialsInfo: info, setCredentials: async (b: unknown) => { saved.push(b); return save(b); } } },
      { provide: Router, useValue: { navigate: async (...a: unknown[]) => { navigated.push(a); return true; } } },
    ],
  });
  const fixture = TestBed.createComponent(SetPasswordComponent);
  fixture.componentRef.setInput('t', 'tok');
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, navigated, saved };
}
const settle = async (f: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => { await f.whenStable(); f.detectChanges(); };

describe('SetPasswordComponent (IB-079)', () => {
  it('no account yet: asks for a login; saves it lower-cased and sends the member to /login, signed OUT', async () => {
    const { fixture, cmp, navigated, saved } = setup(async () => ({ hasLogin: false }));
    await settle(fixture);
    expect(cmp.view()).toBe('form');
    expect((fixture.nativeElement as HTMLElement).querySelector('input[autocomplete="username"]:not([readonly])')).not.toBeNull();
    cmp.login.set('Bob');
    cmp.password.set('bob password one');
    cmp.repeat.set('bob password one');
    await cmp.submit();
    expect(saved).toEqual([{ token: 'tok', login: 'bob', password: 'bob password one' }]);
    expect(navigated).toEqual([[['/login'], { queryParams: { login: 'bob', saved: 1 } }]]);
  });

  it('an account: the login is read-only and is NOT sent (a reset keeps it)', async () => {
    const { fixture, cmp, saved } = setup(async () => ({ hasLogin: true, login: 'bob' }));
    await settle(fixture);
    const input = (fixture.nativeElement as HTMLElement).querySelector('input[autocomplete="username"]') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('bob');
    cmp.password.set('bob password two');
    cmp.repeat.set('bob password two');
    await cmp.submit();
    expect(saved).toEqual([{ token: 'tok', password: 'bob password two' }]);
  });

  it('checks the rules before sending: a mismatched repeat never reaches the server', async () => {
    const { fixture, cmp, saved } = setup(async () => ({ hasLogin: false }));
    await settle(fixture);
    cmp.login.set('bob');
    cmp.password.set('bob password one');
    cmp.repeat.set('bob password 1');
    await cmp.submit();
    expect(saved).toEqual([]);
    expect(cmp.error()?.key).toBe('rule.mismatch');
  });

  it('a dead link (401/410 from GET) shows how to get a new one', async () => {
    const { fixture, cmp } = setup(async () => { throw new ApiError<string>(410, 'TOKEN_USED', 'x'); });
    await settle(fixture);
    expect(cmp.view()).toBe('dead');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('/password');
  });

  it('409 LOGIN_TAKEN keeps the form: the link still works', async () => {
    const { fixture, cmp } = setup(async () => ({ hasLogin: false }), async () => { throw new ApiError<string>(409, 'LOGIN_TAKEN', 'x'); });
    await settle(fixture);
    cmp.login.set('alice');
    cmp.password.set('alice password');
    cmp.repeat.set('alice password');
    await cmp.submit();
    expect(cmp.view()).toBe('form');
    expect(cmp.error()?.key).toBe('setPassword.loginTaken');
  });
});

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ApiError } from '@backtest-core/api/api-error';
import { InsightApiClient } from '../../core/insight-api.client';
import { SessionService } from '../../core/session.service';
import { LoginComponent } from './login.component';

/** IB-079 — the login form against a stubbed API: what it sends, where it goes, what it says. */
function setup(login: (body: unknown) => Promise<unknown>) {
  const navigated: string[] = [];
  const sent: unknown[] = [];
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      { provide: InsightApiClient, useValue: { authContext: async () => ({ botUsername: 'slot_bot' }), login: async (b: unknown) => { sent.push(b); return login(b); } } },
      { provide: Router, useValue: { navigateByUrl: async (u: string) => { navigated.push(u); return true; } } },
    ],
  });
  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, navigated, sent, session: TestBed.inject(SessionService) };
}

const member = { id: 2, tgUserId: 222, role: 'member' as const, lang: 'en' as const, login: 'bob' };

describe('LoginComponent (IB-079)', () => {
  it('posts login + password, makes the member known, and lands on the market', async () => {
    const { cmp, navigated, sent, session } = setup(async () => ({ user: member }));
    cmp.login.set('Bob');
    cmp.password.set('bob password one');
    await cmp.submit();
    expect(sent).toEqual([{ login: 'Bob', password: 'bob password one' }]);
    expect(session.user()?.login).toBe('bob');
    expect(navigated).toEqual(['/market']);
  });

  it('401 is the one generic sentence, and the password field is cleared', async () => {
    const { cmp, navigated } = setup(async () => { throw new ApiError<string>(401, 'INVALID_CREDENTIALS', 'x'); });
    cmp.login.set('bob');
    cmp.password.set('wrong');
    await cmp.submit();
    expect(cmp.error()?.key).toBe('login.wrong');
    expect(cmp.password()).toBe('');
    expect(navigated).toEqual([]);
  });

  it('429 says to wait', async () => {
    const { cmp } = setup(async () => { throw new ApiError<string>(429, 'TOO_MANY_ATTEMPTS', 'x'); });
    await cmp.submit();
    expect(cmp.error()?.key).toBe('login.tooMany');
  });

  it('autocomplete lets a phone\'s password manager fill the form', () => {
    const { fixture } = setup(async () => ({ user: member }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[autocomplete="username"]')).not.toBeNull();
    expect(el.querySelector('input[type="password"][autocomplete="current-password"]')).not.toBeNull();
  });

  it('names the bot for /password once it is known', async () => {
    const { fixture } = setup(async () => ({ user: member }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('@slot_bot');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('/password');
  });
});

import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { InsightApiClient } from '../../core/insight-api.client';
import { loginFailure, LoginComponent } from './login.component';

/**
 * The failure sentences a member sees, and — the part that matters most — that arriving with a
 * token signs them in without a click.
 *
 * **That behaviour regressed once.** IB-BUG-004's i18n rewrite of this component dropped the
 * effect, and nothing failed: the page still rendered, still translated, still exchanged when a
 * button was pressed. It was caught by a person opening the page. This spec is why it cannot go
 * quietly again.
 */
type Exchange = (token: string) => Promise<{ user?: { lang?: unknown } }>;

function setup(token: string | undefined, exchange: Exchange = async () => ({ user: { lang: 'en' } })) {
  const navigated: string[] = [];
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: InsightApiClient, useValue: { exchange } },
    ],
  });
  const router = TestBed.inject(Router);
  router.navigateByUrl = (url: string) => (navigated.push(String(url)), Promise.resolve(true));
  const fixture = TestBed.createComponent(LoginComponent);
  fixture.componentRef.setInput('t', token);
  fixture.detectChanges();
  return { fixture, navigated, component: fixture.componentInstance };
}

describe('LoginComponent — the link is the sign-in', () => {
  it('exchanges the token on arrival, with no click, and goes to /health', async () => {
    const calls: string[] = [];
    const { navigated } = setup('tok-1', async (t) => {
      calls.push(t);
      return { user: { lang: 'en' } };
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['tok-1']);
    expect(navigated).toEqual(['/health']);
  });

  it('does nothing at all when the link carries no token — no request, no failure banner', async () => {
    const calls: string[] = [];
    const { component } = setup(undefined, async (t) => {
      calls.push(t);
      return { user: {} };
    });
    await Promise.resolve();
    expect(calls).toEqual([]);
    // the page shows its hint ("open the link the bot sent you"); a red failure would be wrong,
    // because nobody has tried anything yet
    expect(component.state()).toBe('idle');
  });
});

describe('loginFailure — the sentence is chosen by the code, never the status', () => {
  it('gives the two HTTP 410 cases different keys: used and expired are different mistakes', () => {
    expect(loginFailure('TOKEN_USED', 410).key).toBe('login.used');
    expect(loginFailure('TOKEN_EXPIRED', 410).key).toBe('login.expired');
    // this is the distinction IB-BUG-004's rewrite lost by branching on the status again
    expect(loginFailure('TOKEN_USED', 410).key).not.toBe(loginFailure('TOKEN_EXPIRED', 410).key);
  });

  it('an invalid token has its own key', () => {
    expect(loginFailure('TOKEN_INVALID', 401).key).toBe('login.invalid');
  });

  it('falls back to the status rather than inventing a cause when no code arrives', () => {
    expect(loginFailure(null, 500)).toEqual({ key: 'login.failed', params: { status: 500 } });
    expect(loginFailure(undefined, 502)).toEqual({ key: 'login.failed', params: { status: 502 } });
  });
});

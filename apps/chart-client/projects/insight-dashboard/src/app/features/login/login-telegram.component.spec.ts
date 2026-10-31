import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { LoginComponent } from './login.component';
import { TELEGRAM_AUTH_CALLBACK } from './telegram-widget';
import { LANDING_ROUTE } from '../../app.routes';

/**
 * IB-072 — the widget on /login, end to end inside the page: the script is mounted for the bot the
 * server names, the global callback posts the payload untouched, and each answer lands right.
 * `fetch` is faked per URL so the context call and the login call can disagree with each other.
 */
type Reply = { status: number; body?: unknown };

describe('LoginComponent — Log in with Telegram', () => {
  let calls: Array<{ url: string; init?: RequestInit }>;
  let navigated: string[];
  let loginReply: Reply;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    calls = [];
    navigated = [];
    loginReply = { status: 200, body: { user: { id: 1, tgUserId: 7, role: 'member', lang: 'en' } } };
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const reply: Reply = url === '/api/web/auth/context' ? { status: 200, body: { botUsername: 'slot_test_bot' } } : loginReply;
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.body } as Response;
    }) as typeof fetch;
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: { navigateByUrl: (u: string) => { navigated.push(u); return Promise.resolve(true); } } }],
    });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function render(t?: string) {
    const fixture = TestBed.createComponent(LoginComponent);
    if (t !== undefined) fixture.componentRef.setInput('t', t);
    // context arrives → the host renders → the effect sees it: three turns, as in the running app
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    return fixture;
  }

  const callback = () => (window as unknown as Record<string, (u: unknown) => void>)[TELEGRAM_AUTH_CALLBACK];

  it('mounts the widget script for the bot the server names', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    const script = el.querySelector('.telegram-widget script');
    expect(script?.getAttribute('data-telegram-login')).toBe('slot_test_bot');
  });

  it('does not show the widget while a ?t= link waits to be exchanged', async () => {
    const el = (await render('link-token')).nativeElement as HTMLElement;
    expect(el.querySelector('.telegram-widget')).toBeNull();
  });

  it('posts the payload untouched (unknown fields too) and goes to the landing route', async () => {
    const fixture = await render();
    const payload = { id: 7, first_name: 'A', auth_date: 1, hash: 'h', new_field: 'kept' };
    await fixture.componentInstance.telegramLogin(payload);
    const post = calls.find((c) => c.url === '/api/web/auth/telegram');
    expect(post?.init?.method).toBe('POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual(payload);
    expect(navigated).toEqual([LANDING_ROUTE]);
  });

  it('the global callback the widget calls is wired to telegramLogin, and removed on destroy', async () => {
    const fixture = await render();
    const spy = vi.spyOn(fixture.componentInstance, 'telegramLogin').mockResolvedValue();
    callback()({ id: 1 });
    expect(spy).toHaveBeenCalledWith({ id: 1 });
    fixture.destroy();
    expect(callback()).toBeUndefined();
  });

  it('NOT_A_MEMBER: says "by invitation" and links to the bot; no navigation', async () => {
    loginReply = { status: 403, body: { code: 'NOT_A_MEMBER' } };
    const fixture = await render();
    await fixture.componentInstance.telegramLogin({ id: 9 });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(el.querySelector('a.bot-link')?.getAttribute('href')).toBe('https://t.me/slot_test_bot');
    expect(navigated).toEqual([]);
  });

  it('a 401 does not show the bot link meant for strangers', async () => {
    loginReply = { status: 401, body: { code: 'TOKEN_INVALID' } };
    const fixture = await render();
    await fixture.componentInstance.telegramLogin({ id: 9 });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('a.bot-link')).toBeNull();
  });
});

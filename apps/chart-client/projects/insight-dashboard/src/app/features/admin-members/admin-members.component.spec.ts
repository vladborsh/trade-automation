import { TestBed } from '@angular/core/testing';
import { ApiError } from '@backtest-core/api/api-error';
import type { WebMember } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { InsightApiClient } from '../../core/insight-api.client';
import { SessionService } from '../../core/session.service';
import { I18nService } from '../../i18n/i18n.service';
import { AdminMembersComponent } from './admin-members.component';

/** IB-035 — the members page: confirm before acting, the server's 409 said in words, the invite shown once. */
const member = (over: Partial<WebMember>): WebMember => ({
  id: 2, tgUserId: 222, login: 'bob', role: 'member', disabled: false, createdAt: 0, lastLoginAt: null, activeSessions: 1, ...over,
});

async function setup(api: Partial<Record<keyof InsightApiClient, unknown>> = {}) {
  const calls: Array<[number, boolean]> = [];
  TestBed.configureTestingModule({
    imports: [AdminMembersComponent],
    providers: [{
      provide: InsightApiClient,
      useValue: {
        members: async () => ({ members: [member({ id: 1, tgUserId: 111, role: 'admin', login: 'owner' }), member({})] }),
        setMemberDisabled: async (id: number, disabled: boolean) => { calls.push([id, disabled]); return { member: member({ id, disabled, activeSessions: 0 }) }; },
        createInvite: async () => ({ link: 'https://t.me/insight_bot?start=abc', expiresAt: Date.UTC(2026, 10, 11) }),
        ...api,
      },
    }],
  });
  TestBed.inject(I18nService).setLang('en');
  TestBed.inject(SessionService).signedIn({ id: 1, tgUserId: 111, role: 'admin', lang: 'en', login: 'owner' });
  const fixture = TestBed.createComponent(AdminMembersComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, calls, el: fixture.nativeElement as HTMLElement };
}

const buttons = (el: HTMLElement) => [...el.querySelectorAll('tbody button')].map((b) => b.textContent?.trim());

describe('AdminMembersComponent (IB-035)', () => {
  it('the admin\'s own row has no button; the member\'s row offers Disable', async () => {
    const { el } = await setup();
    expect(buttons(el)).toEqual(['Disable']);
    expect(el.querySelector('tbody tr td:last-child')?.textContent?.trim()).toBe('you');
  });

  it('nothing is sent until the admin confirms; confirming disables and the row turns to Enable', async () => {
    const { cmp, calls, fixture, el } = await setup();
    cmp.ask(2);
    fixture.detectChanges();
    expect(calls).toEqual([]);
    expect(buttons(el)).toEqual(['Yes', 'Cancel']);
    await cmp.confirm(2, true);
    fixture.detectChanges();
    expect(calls).toEqual([[2, true]]);
    expect(buttons(el)).toEqual(['Enable']);
  });

  it('a 409 is said in words, from the server\'s code', async () => {
    const { cmp } = await setup({ setMemberDisabled: async () => { throw new ApiError<string>(409, 'LAST_ADMIN', 'x'); } });
    await cmp.confirm(2, true);
    expect(cmp.actionError()).toBe('members.refused.lastAdmin');
  });

  it('a new invite shows its link once, with a copy button; it is not part of the table', async () => {
    const { cmp, fixture, el } = await setup();
    await cmp.createInvite();
    fixture.detectChanges();
    expect((el.querySelector('input.link') as HTMLInputElement).value).toBe('https://t.me/insight_bot?start=abc');
    expect(el.querySelector('tbody')?.textContent).not.toContain('start=abc');
  });
});

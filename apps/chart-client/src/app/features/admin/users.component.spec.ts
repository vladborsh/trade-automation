import { vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AdminInvite, AdminUser, User } from '@trade-automation/contracts';
import { RestClient } from '../../core/api/rest.client';
import { AuthService } from '../../core/auth/auth.service';
import { UsersComponent } from './users.component';

const ME: User = { id: 'admin', email: 'admin@example.com', role: 'admin' };
const USERS: AdminUser[] = [
  { id: 'admin', email: 'admin@example.com', role: 'admin', createdAt: 1, disabledAt: null },
  { id: 'u1', email: 'one@example.com', role: 'user', createdAt: 2, disabledAt: null },
];
const INVITES: AdminInvite[] = [{ id: 'i1', email: null, createdAt: 1, expiresAt: Date.now() + 1e6, usedAt: null, usedBy: null }];

/** Let the store's fetch promises resolve, then render. */
async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
  fixture.detectChanges();
}

async function setup() {
  const rest = {
    listUsers: vi.fn().mockResolvedValue(USERS),
    listInvites: vi.fn().mockResolvedValue(INVITES),
    createInvite: vi.fn().mockResolvedValue({ id: 'i2', url: 'http://localhost:4220/invite/abc', expiresAt: Date.now() + 1e6 }),
    disableUser: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.configureTestingModule({
    imports: [UsersComponent],
    providers: [
      provideRouter([]),
      { provide: RestClient, useValue: rest },
      { provide: AuthService, useValue: { user: signal(ME).asReadonly(), isAdmin: signal(true).asReadonly() } },
    ],
  });
  const fixture = TestBed.createComponent(UsersComponent);
  fixture.detectChanges();
  await settle(fixture);
  return { fixture, rest, el: fixture.nativeElement as HTMLElement };
}

describe('UsersComponent (admin page, decision 30)', () => {
  it('loads users and invites into the two sections; the admin is marked "you"', async () => {
    const { el } = await setup();
    expect(el.querySelector('h1')?.textContent).toBe('Users and invites');
    expect(el.querySelectorAll('app-admin-users-table tbody tr')).toHaveLength(2);
    expect(el.querySelectorAll('app-admin-invites tbody tr')).toHaveLength(1);
    expect(el.querySelector('[data-testid="user-admin@example.com"]')?.textContent).toContain('you');
  });

  it('has no link from the page body to any session or journal', async () => {
    const { el } = await setup();
    expect(el.querySelector('main')!.querySelectorAll('a')).toHaveLength(0);
  });

  it('create invite → the one-time URL appears; disable → confirm → server call', async () => {
    const { fixture, el, rest } = await setup();
    el.querySelector('app-admin-invites form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(rest.createInvite).toHaveBeenCalledWith({});
    expect(el.querySelector<HTMLInputElement>('[aria-label="Invite link"]')!.value).toBe('http://localhost:4220/invite/abc');

    const row = el.querySelector<HTMLElement>('[data-testid="user-one@example.com"]')!;
    [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Disable')!.click();
    fixture.detectChanges();
    [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm disable')!.click();
    await settle(fixture);
    expect(rest.disableUser).toHaveBeenCalledWith('u1');
  });
});

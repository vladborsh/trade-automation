import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { AdminInvite, AdminUser } from '@trade-automation/contracts';
import { ApiError } from '../../core/api/api-error';
import { RestClient } from '../../core/api/rest.client';
import { AdminStore } from './admin.store';

const USERS: AdminUser[] = [{ id: 'u1', email: 'a@example.com', role: 'admin', createdAt: 1, disabledAt: null }];
const INVITES: AdminInvite[] = [{ id: 'i1', email: null, createdAt: 1, expiresAt: 2, usedAt: null, usedBy: null }];

function setup(overrides: Partial<Record<keyof RestClient, unknown>> = {}) {
  const rest = {
    listUsers: vi.fn().mockResolvedValue(USERS),
    listInvites: vi.fn().mockResolvedValue(INVITES),
    disableUser: vi.fn().mockResolvedValue(undefined),
    enableUser: vi.fn().mockResolvedValue(undefined),
    createInvite: vi.fn().mockResolvedValue({ id: 'i2', url: 'http://x/invite/tok', expiresAt: 99 }),
    revokeInvite: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [AdminStore, { provide: RestClient, useValue: rest }] });
  return { store: TestBed.inject(AdminStore), rest };
}

describe('AdminStore', () => {
  it('load reads users and invites', async () => {
    const { store } = setup();
    await store.load();
    expect(store.users()).toEqual(USERS);
    expect(store.invites()).toEqual(INVITES);
    expect(store.error()).toBeNull();
  });

  it('load failure shows a message', async () => {
    const { store } = setup({ listUsers: vi.fn().mockRejectedValue(new ApiError(500, null, 'x')) });
    await store.load();
    expect(store.error()).toBe('Could not load users and invites. Try again.');
  });

  it('disable goes through confirmation, calls the server, clears the confirm state and refreshes', async () => {
    const { store, rest } = setup();
    store.askDisable('u2');
    expect(store.confirmingDisable()).toBe('u2');
    await store.disable('u2');
    expect(rest.disableUser).toHaveBeenCalledWith('u2');
    expect(store.confirmingDisable()).toBeNull();
    expect(rest.listUsers).toHaveBeenCalledTimes(1);
    expect(store.busy()).toBeNull();
  });

  it('createInvite keeps the one-time URL in memory until dismissed; blank email sends an empty body', async () => {
    const { store, rest } = setup();
    await store.createInvite(undefined);
    expect(rest.createInvite).toHaveBeenCalledWith({});
    expect(store.created()).toEqual({ url: 'http://x/invite/tok', expiresAt: 99, email: null });
    await store.createInvite('n@example.com');
    expect(rest.createInvite).toHaveBeenLastCalledWith({ email: 'n@example.com' });
    store.dismissCreated();
    expect(store.created()).toBeNull();
  });

  it('a refused action shows its message and still refreshes', async () => {
    const { store, rest } = setup({ revokeInvite: vi.fn().mockRejectedValue(new ApiError(409, 'INVITE_USED', 'used')) });
    await store.revoke('i1');
    expect(store.error()).toContain('already been used');
    expect(rest.listInvites).toHaveBeenCalledTimes(1);
  });

  it('enable calls the server', async () => {
    const { store, rest } = setup();
    await store.enable('u3');
    expect(rest.enableUser).toHaveBeenCalledWith('u3');
  });
});

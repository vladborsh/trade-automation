import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { User } from '@trade-automation/contracts';
import { ApiError } from '../api/api-error';
import { RestClient } from '../api/rest.client';
import { AuthService } from './auth.service';
import { HARD_NAVIGATE } from './hard-navigate';

const ADMIN: User = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com', role: 'admin' };

function setup(rest: Partial<Record<keyof RestClient, unknown>>) {
  const hardNavigate = vi.fn();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: RestClient, useValue: rest },
      { provide: HARD_NAVIGATE, useValue: hardNavigate },
    ],
  });
  return { auth: TestBed.inject(AuthService), router: TestBed.inject(Router), hardNavigate };
}

describe('AuthService', () => {
  it('probes GET /auth/me once and remembers the user', async () => {
    const getMe = vi.fn().mockResolvedValue({ user: ADMIN });
    const { auth } = setup({ getMe });

    expect(await auth.ensureSession()).toEqual(ADMIN);
    expect(await auth.ensureSession()).toEqual(ADMIN);
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(auth.user()).toEqual(ADMIN);
    expect(auth.isAdmin()).toBe(true);
  });

  it('caches a 401 as "signed out" but asks again after a network failure', async () => {
    const unauthorized = setup({ getMe: vi.fn().mockRejectedValue(new ApiError(401, null, 'Unauthorized')) });
    expect(await unauthorized.auth.ensureSession()).toBeNull();
    expect(await unauthorized.auth.ensureSession()).toBeNull();
    expect(unauthorized.auth['rest'].getMe).toHaveBeenCalledTimes(1);

    const getMe = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ user: ADMIN });
    const flaky = setup({ getMe });
    expect(await flaky.auth.ensureSession()).toBeNull();
    expect(await flaky.auth.ensureSession()).toEqual(ADMIN);
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it('login sets the user without a second /auth/me probe', async () => {
    const getMe = vi.fn();
    const login = vi.fn().mockResolvedValue({ user: ADMIN });
    const { auth } = setup({ getMe, login });

    await auth.login('admin@example.com', 'admin-password');
    expect(login).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'admin-password' });
    expect(await auth.ensureSession()).toEqual(ADMIN);
    expect(getMe).not.toHaveBeenCalled();
  });

  it('login propagates the server error and leaves the user signed out', async () => {
    const { auth } = setup({ login: vi.fn().mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'x')) });
    await expect(auth.login('a@example.com', 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(auth.user()).toBeNull();
  });

  it('acceptInvite signs the new user in', async () => {
    const user: User = { ...ADMIN, role: 'user', email: 'new@example.com' };
    const acceptInvite = vi.fn().mockResolvedValue({ user });
    const { auth } = setup({ acceptInvite });

    await auth.acceptInvite('tok', 'new@example.com', 'long-enough-pw');
    expect(acceptInvite).toHaveBeenCalledWith('tok', { email: 'new@example.com', password: 'long-enough-pw' });
    expect(auth.user()).toEqual(user);
  });

  it('logout clears the user and reloads at /login even when the server call fails', async () => {
    const { auth, hardNavigate } = setup({
      login: vi.fn().mockResolvedValue({ user: ADMIN }),
      logout: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    await auth.login('admin@example.com', 'admin-password');

    await auth.logout();
    expect(auth.user()).toBeNull();
    expect(hardNavigate).toHaveBeenCalledWith('/login');
  });

  it('handleUnauthorized sends the user to /login with the current URL as returnUrl', async () => {
    const { auth, router } = setup({ login: vi.fn().mockResolvedValue({ user: ADMIN }) });
    await auth.login('admin@example.com', 'admin-password');
    vi.spyOn(router, 'url', 'get').mockReturnValue('/terminal');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    auth.handleUnauthorized();
    expect(auth.user()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/terminal' } });
  });

  it('handleUnauthorized does not navigate while already on a public auth page', () => {
    const { auth, router } = setup({});
    vi.spyOn(router, 'url', 'get').mockReturnValue('/login?returnUrl=%2Fterminal');
    const navigate = vi.spyOn(router, 'navigate');

    auth.handleUnauthorized();
    expect(navigate).not.toHaveBeenCalled();
  });
});

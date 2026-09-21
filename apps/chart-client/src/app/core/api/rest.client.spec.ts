import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AppConfigService } from '../config/app-config.service';
import { ApiError } from './api-error';
import { RestClient } from './rest.client';
import { UNAUTHORIZED_HANDLER } from './unauthorized-handler';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  const onUnauthorized = vi.fn();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: AppConfigService, useValue: { get: () => ({ apiBaseUrl: 'http://localhost:4300/api', wsUrl: '' }) } },
      { provide: UNAUTHORIZED_HANDLER, useValue: onUnauthorized },
    ],
  });
  return { rest: TestBed.inject(RestClient), fetchMock, onUnauthorized };
}

describe('RestClient (backtest-app-system-design.md §7.1)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the session cookie with every request', async () => {
    const { rest, fetchMock } = setup(jsonResponse(200, []));
    await rest.getLayouts();
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4300/api/layouts', expect.objectContaining({ method: 'GET', credentials: 'include' }));
  });

  it('a 401 on a data request goes to /login and rejects with ApiError', async () => {
    const { rest, onUnauthorized } = setup(jsonResponse(401, { statusCode: 401, message: 'Unauthorized' }));
    await expect(rest.getInstruments()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('a 401 from an auth call is the caller’s to handle — wrong password is not a redirect', async () => {
    const { rest, onUnauthorized } = setup(jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Wrong email or password' } }));
    await expect(rest.login({ email: 'a@example.com', password: 'x' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('posts JSON bodies and handles a 204', async () => {
    const { rest, fetchMock } = setup(jsonResponse(204, null));
    await expect(rest.logout()).resolves.toBeUndefined();
    const accept = setup(jsonResponse(201, { user: { id: 'u', email: 'n@example.com', role: 'user' } }));
    await accept.rest.acceptInvite('a/b', { email: 'n@example.com', password: 'long-enough-pw' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4300/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    expect(accept.fetchMock).toHaveBeenCalledWith(
      'http://localhost:4300/api/auth/invites/a%2Fb/accept',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'n@example.com', password: 'long-enough-pw' }),
      }),
    );
  });

  it('admin fetchers: paths, methods, bodies, and a 401 redirects like any data request', async () => {
    const list = setup(jsonResponse(200, []));
    await list.rest.listUsers();
    expect(list.fetchMock).toHaveBeenCalledWith('http://localhost:4300/api/admin/users', expect.objectContaining({ method: 'GET', credentials: 'include' }));

    const disable = setup(jsonResponse(204, null));
    await expect(disable.rest.disableUser('u/1')).resolves.toBeUndefined();
    expect(disable.fetchMock).toHaveBeenCalledWith('http://localhost:4300/api/admin/users/u%2F1/disable', expect.objectContaining({ method: 'POST' }));

    const enable = setup(jsonResponse(204, null));
    await enable.rest.enableUser('u1');
    expect(enable.fetchMock).toHaveBeenCalledWith('http://localhost:4300/api/admin/users/u1/enable', expect.objectContaining({ method: 'POST' }));

    const create = setup(jsonResponse(201, { id: 'i', url: 'http://x/invite/t', expiresAt: 1 }));
    await expect(create.rest.createInvite({ email: 'n@example.com' })).resolves.toMatchObject({ url: 'http://x/invite/t' });
    expect(create.fetchMock).toHaveBeenCalledWith(
      'http://localhost:4300/api/admin/invites',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'n@example.com' }) }),
    );

    const invites = setup(jsonResponse(200, []));
    await invites.rest.listInvites();
    expect(invites.fetchMock).toHaveBeenCalledWith('http://localhost:4300/api/admin/invites', expect.objectContaining({ method: 'GET' }));

    const revoke = setup(jsonResponse(409, { error: { code: 'INVITE_USED', message: 'used' } }));
    await expect(revoke.rest.revokeInvite('i1')).rejects.toMatchObject({ status: 409, code: 'INVITE_USED' });
    expect(revoke.fetchMock).toHaveBeenCalledWith('http://localhost:4300/api/admin/invites/i1', expect.objectContaining({ method: 'DELETE' }));

    const expired = setup(jsonResponse(401, { statusCode: 401, message: 'Unauthorized' }));
    await expect(expired.rest.listInvites()).rejects.toBeInstanceOf(ApiError);
    expect(expired.onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

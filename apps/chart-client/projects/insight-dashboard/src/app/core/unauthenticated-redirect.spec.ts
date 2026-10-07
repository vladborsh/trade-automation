import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { InsightApiClient } from './insight-api.client';
import { AppConfigService } from '@backtest-core/config/app-config.service';

/**
 * IB-BUG-008 — with no session, every page used to render the raw
 * `GET /health/streams failed: UNAUTHENTICATED`, which tells a member nothing they can act on.
 *
 * The redirect lives in the one place every guarded call passes through, so a page added later
 * inherits it instead of having to remember; these tests pin that, and pin that it does NOT fire
 * on other failures, which would hide real errors behind a login screen.
 */

function setup(status: number, body: unknown) {
  const navigated: string[] = [];
  TestBed.configureTestingModule({
    providers: [
      InsightApiClient,
      { provide: Router, useValue: { navigateByUrl: (url: string) => { navigated.push(url); return Promise.resolve(true); } } },
      { provide: AppConfigService, useValue: { get: () => ({ apiBaseUrl: '/api/web' }) } },
    ],
  });
  globalThis.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  return { api: TestBed.inject(InsightApiClient), navigated };
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('an unauthenticated call sends the member to the login screen', () => {
  it('redirects on 401 UNAUTHENTICATED', async () => {
    const { api, navigated } = setup(401, { code: 'UNAUTHENTICATED' });
    await expect(api.streams()).rejects.toThrow();
    expect(navigated).toEqual(['/login']);
  });

  it('still throws, so the calling page settles its own loading state', async () => {
    const { api } = setup(401, { code: 'UNAUTHENTICATED' });
    // a swallowed error would leave a page spinning forever behind the redirect
    await expect(api.streams()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('does NOT redirect on other failures — that would hide a real error behind a login page', async () => {
    for (const [status, body] of [[403, { code: 'FORBIDDEN' }], [400, { code: 'RANGE_TOO_WIDE' }], [500, null]] as const) {
      const { api, navigated } = setup(status, body);
      await expect(api.streams()).rejects.toThrow();
      expect(navigated).toEqual([]);
      TestBed.resetTestingModule();
    }
  });

  it('does not redirect on success', async () => {
    const { api, navigated } = setup(200, { streams: [] });
    await api.streams();
    expect(navigated).toEqual([]);
  });
});

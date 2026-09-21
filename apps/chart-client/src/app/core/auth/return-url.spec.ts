import { DEFAULT_AUTHED_URL, safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it('keeps an in-app path, query included', () => {
    expect(safeReturnUrl('/terminal')).toBe('/terminal');
    expect(safeReturnUrl('/sessions/abc?viewAt=1')).toBe('/sessions/abc?viewAt=1');
  });

  it('falls back to the default route when absent', () => {
    expect(safeReturnUrl(null)).toBe(DEFAULT_AUTHED_URL);
    expect(safeReturnUrl(undefined)).toBe(DEFAULT_AUTHED_URL);
    expect(safeReturnUrl('')).toBe(DEFAULT_AUTHED_URL);
  });

  it('refuses anything that could leave the app (open-redirect shapes)', () => {
    for (const raw of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'terminal']) {
      expect(safeReturnUrl(raw)).toBe(DEFAULT_AUTHED_URL);
    }
  });

  it('never sends a freshly signed-in user back to the public auth pages', () => {
    expect(safeReturnUrl('/login')).toBe(DEFAULT_AUTHED_URL);
    expect(safeReturnUrl('/login?returnUrl=%2Fterminal')).toBe(DEFAULT_AUTHED_URL);
    expect(safeReturnUrl('/invite/abc')).toBe(DEFAULT_AUTHED_URL);
  });
});

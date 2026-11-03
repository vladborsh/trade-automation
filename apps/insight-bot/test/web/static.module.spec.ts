import { DASHBOARD_EXCLUDE } from '../../src/web/static.module';

// The matcher @nestjs/serve-static actually uses: its own vendored path-to-regexp (0.2.5), tested
// against `pathname + '/'` exactly as `is-route-excluded.util.js` does.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pathToRegexp = require('@nestjs/serve-static/node_modules/path-to-regexp');
const compile = (pattern: string): RegExp => (typeof pathToRegexp === 'function' ? pathToRegexp : pathToRegexp.pathToRegexp)(pattern);
const excluded = (url: string): boolean => DASHBOARD_EXCLUDE.some((pattern) => compile(pattern).exec(`${url}/`) !== null);

/**
 * IB-030 — the SPA fallback must never answer for the API or the ops endpoints.
 *
 * This is pinned against the real matcher rather than trusted from the docs: the version Nest
 * documents (`/api/{*splat}`) compiles to a regex that matches nothing in the vendored 0.2.5, so
 * the fallback quietly served `index.html` for every unrouted `/api/web/*` path — a 200 page of
 * HTML where a client expected a 404 or JSON. Caught by hand on a running server; this spec is so
 * it cannot come back.
 */
describe('the dashboard SPA fallback exclusions', () => {
  it.each([
    '/api',
    '/api/web/coverage',
    '/api/web/health/streams',
    '/api/web/nope',            // the case that regressed: unrouted, must not get index.html
    '/api/anything/at/all',
    '/healthz',                 // WD-011: the ops liveness probe
    '/metrics',
  ])('%s is excluded from the fallback', (url) => {
    expect(excluded(url)).toBe(true);
  });

  it.each([
    '/',
    '/login',
    '/coverage',
    '/health',                  // WD-011: the dashboard's admin Health page — a reload must get index.html
    '/health/',
    '/healthz-page',            // a page whose name merely starts like the ops route
    '/instrument/BTCUSDT',      // IB-031's route: a deep link must still boot the SPA
    '/market',
  ])('%s still falls through to the SPA', (url) => {
    expect(excluded(url)).toBe(false);
  });

  it('the documented Nest 4 syntax matches nothing here — the reason these patterns look dated', () => {
    expect(compile('/api/{*splat}').exec('/api/web/nope/')).toBeNull();
  });
});

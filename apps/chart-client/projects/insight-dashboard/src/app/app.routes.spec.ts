import { LANDING_ROUTE, routes } from './app.routes';
import { en } from './i18n/en';
import { ru } from './i18n/ru';

/**
 * Where a member lands is a product decision, so it is asserted rather than left to a string in
 * three files. IB-031 merged a page no menu could reach and everyone signed it off, because the
 * tests and the screenshots were good — these are the tests that would have caught it.
 *
 * IB-037 moved the landing page from the instrument view to the market cards. The assertions below
 * follow `LANDING_ROUTE` rather than naming a page twice, so the next move is one edit again.
 */
describe('landing', () => {
  const redirectFor = (path: string) => routes.find((r) => r.path === path)?.redirectTo;
  const landingPath = LANDING_ROUTE.replace(/^\//, '');

  it('sends a member to the market cards, not to the operator’s page', () => {
    expect(LANDING_ROUTE).toBe('/market');
    expect(redirectFor('')).toBe(landingPath);
  });

  it('sends an unknown path to the same place — an old link must not open diagnostics', () => {
    expect(redirectFor('**')).toBe(landingPath);
  });

  it('never redirects anywhere to health', () => {
    const redirects = routes.map((r) => r.redirectTo).filter((r): r is string => r !== undefined);
    expect(redirects).not.toContain('health');
  });

  it('keeps the landing route a real route, so the redirect cannot point at nothing', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain(landingPath);
  });

  it('still serves every page, including the operator’s two', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('market');
    expect(paths).toContain('instrument/:symbol');
    expect(paths).toContain('health');
    expect(paths).toContain('coverage');
    expect(paths).toContain('login');
  });

  it('orders the table the way the nav reads: market, instrument, then the operator pages', () => {
    const order = routes.map((r) => r.path).filter((p) => p && !['', '**', 'login'].includes(p));
    expect(order).toEqual(['health', 'coverage', 'instrument/:symbol', 'market']);
  });
});

describe('the nav labels', () => {
  it('are prose in both languages, not identifiers', () => {
    for (const key of ['nav.market', 'nav.instrument', 'nav.health', 'nav.coverage'] as const) {
      expect(ru[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
      expect(ru[key]).not.toBe(en[key]); // a label identical in both is usually untranslated
    }
  });

  it('gives Market and Instrument Russian labels, since those are what a member lands on', () => {
    expect(ru['nav.market']).toMatch(/\p{Script=Cyrillic}/u);
    expect(ru['nav.instrument']).toMatch(/\p{Script=Cyrillic}/u);
  });
});

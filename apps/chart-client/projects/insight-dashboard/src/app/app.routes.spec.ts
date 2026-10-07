import { LANDING_ROUTE, routes } from './app.routes';
import { en } from './i18n/en';
import { ru } from './i18n/ru';

/**
 * Where a member lands is a product decision, so it is asserted rather than left to a string in
 * three files. IB-031 merged a page no menu could reach and everyone signed it off, because the
 * tests and the screenshots were good — these are the tests that would have caught it.
 */
describe('landing', () => {
  const redirectFor = (path: string) => routes.find((r) => r.path === path)?.redirectTo;

  it('sends a member to insights, not to the operator’s page', () => {
    expect(LANDING_ROUTE).toBe('/instrument/BTCUSDT');
    expect(redirectFor('')).toBe('instrument/BTCUSDT');
  });

  it('sends an unknown path to the same place — an old link must not open diagnostics', () => {
    expect(redirectFor('**')).toBe('instrument/BTCUSDT');
  });

  it('never redirects anywhere to health', () => {
    const redirects = routes.map((r) => r.redirectTo).filter((r): r is string => r !== undefined);
    expect(redirects).not.toContain('health');
  });

  it('keeps the landing route a real route, so the redirect cannot point at nothing', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('instrument/:symbol');
  });

  it('still serves the operator’s pages', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('health');
    expect(paths).toContain('coverage');
  });
});

describe('the nav', () => {
  it('labels the instrument entry in both languages, as prose', () => {
    expect(ru['nav.instrument']).toBeTruthy();
    expect(en['nav.instrument']).toBeTruthy();
    expect(ru['nav.instrument']).not.toBe(en['nav.instrument']);
    expect(ru['nav.instrument']).toMatch(/\p{Script=Cyrillic}/u);
  });
});

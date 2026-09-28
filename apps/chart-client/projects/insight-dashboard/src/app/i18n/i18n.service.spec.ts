import { TestBed } from '@angular/core/testing';
import { I18nService, fill } from './i18n.service';
import { DEFAULT_LANG } from './keys';
import { ru } from './ru';
import { en } from './en';

/** §11 — language comes from the member, defaults to ru, and a broken key fails loudly in dev. */
describe('I18nService', () => {
  let i18n: I18nService;

  beforeEach(() => {
    try {
      localStorage.removeItem('insight.lang');
    } catch {
      // storage may be unavailable; the service copes and so does this spec
    }
    TestBed.configureTestingModule({});
    i18n = TestBed.inject(I18nService);
  });

  it('defaults to ru, which is the ruling’s default', () => {
    expect(DEFAULT_LANG).toBe('ru');
    expect(i18n.lang()).toBe('ru');
    expect(i18n.t('health.title')).toBe(ru['health.title']);
  });

  it('follows the member’s lang from /auth/me', () => {
    i18n.setLangFromUser('en');
    expect(i18n.lang()).toBe('en');
    expect(i18n.t('health.title')).toBe(en['health.title']);
  });

  it('ignores a lang it does not have rather than guessing or blanking the UI', () => {
    i18n.setLangFromUser('de');
    expect(i18n.lang()).toBe('ru');
    i18n.setLangFromUser(undefined);
    expect(i18n.lang()).toBe('ru');
    i18n.setLangFromUser(42);
    expect(i18n.lang()).toBe('ru');
  });

  it('remembers the login page’s switch for the next load', () => {
    i18n.setLang('en');
    expect(i18n.lang()).toBe('en');
    const fresh = TestBed.inject(I18nService);
    expect(fresh.lang()).toBe('en');
  });

  it('fills placeholders', () => {
    expect(i18n.t('health.dbPartitions', { count: 28, horizon: '2026-12' })).toContain('28');
    expect(i18n.t('health.dbPartitions', { count: 28, horizon: '2026-12' })).toContain('2026-12');
  });

  it('throws in dev for a key no table carries, rather than rendering the key at a member', () => {
    // the compile-time Record<StringKey, string> already prevents a missing key; this is the runtime
    // path for a key built from API data, and it must be loud
    expect(() => i18n.t('nope.not.a.key' as never)).toThrow(/no string for key/);
  });
});

describe('fill', () => {
  it('substitutes every occurrence of a placeholder', () => {
    expect(fill('{a} and {a} and {b}', { a: '1', b: '2' })).toBe('1 and 1 and 2');
  });

  it('leaves an unknown placeholder visible instead of printing undefined', () => {
    expect(fill('HTTP {status}', {})).toBe('HTTP {status}');
  });

  it('returns the template untouched when there is nothing to fill', () => {
    expect(fill('plain')).toBe('plain');
  });

  it('accepts numbers as well as strings', () => {
    expect(fill('{n} series', { n: 7 })).toBe('7 series');
  });
});

import { loginFailure } from './login.component';
import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';

/**
 * §11 — the failure sentences come from the tables, so the spec asserts which KEY a status maps to
 * and that both languages carry a real sentence for it. Asserting the English text here would have
 * re-introduced exactly the literals the ruling removed.
 */
describe('loginFailure', () => {
  it('maps each IB-029 status to its own key', () => {
    expect(loginFailure(401).key).toBe('login.invalid');
    expect(loginFailure(410).key).toBe('login.used');
    expect(loginFailure(500)).toEqual({ key: 'login.failed', params: { status: 500 } });
  });

  it('names the way out in both languages — /web is how a member recovers', () => {
    for (const table of [ru, en]) {
      expect(table['login.invalid']).toContain('/web');
      expect(table['login.used']).toContain('/web');
    }
  });

  it('keeps the status visible rather than inventing a cause', () => {
    for (const table of [ru, en]) {
      expect(table['login.failed']).toContain('{status}');
    }
  });
});

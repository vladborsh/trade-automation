import { isAdmin, sessionUser } from './session-user';

/** IB-075 — reading the member from `/auth/me`, and the one question the gate asks of it. */
const me = (role: string) => ({ user: { id: 1, tgUserId: 111, role, lang: 'en' } });

describe('sessionUser', () => {
  it('returns the member from a well-formed /auth/me body', () => {
    expect(sessionUser(me('admin'))).toEqual({ id: 1, tgUserId: 111, role: 'admin', lang: 'en' });
  });

  it('is null for anything that is not the contract — never a guessed member', () => {
    for (const body of [null, undefined, {}, { user: null }, 'html', me('owner'), { user: { role: 'admin' } }]) {
      expect(sessionUser(body)).toBeNull();
    }
  });
});

describe('isAdmin', () => {
  it('is true only for role admin', () => {
    expect(isAdmin(sessionUser(me('admin')))).toBe(true);
    expect(isAdmin(sessionUser(me('member')))).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});

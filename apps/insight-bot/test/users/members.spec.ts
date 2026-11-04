import { disableRefusal, newInvite, settingsPatchFromWeb } from '../../src/users/members';
import { INVITE_TTL_MS } from '../../src/users/user.model';

/** IB-035 — the members page's decisions. */
describe('disableRefusal', () => {
  const admin = { id: 1, role: 'admin' as const, disabled: false };
  const member = { id: 2, role: 'member' as const, disabled: false };

  it('an admin cannot disable themselves, even with other admins around', () => {
    expect(disableRefusal(1, admin, 3)).toBe('CANNOT_DISABLE_SELF');
  });

  it('the last active admin cannot be disabled by another admin; with two active, one can go', () => {
    const other = { id: 3, role: 'admin' as const, disabled: false };
    expect(disableRefusal(1, other, 1)).toBe('LAST_ADMIN');
    expect(disableRefusal(1, other, 2)).toBeNull();
  });

  it('a member can always be disabled; an already-disabled admin is not "the last active" one', () => {
    expect(disableRefusal(1, member, 1)).toBeNull();
    expect(disableRefusal(1, { id: 3, role: 'admin', disabled: true }, 1)).toBeNull();
  });
});

describe('settingsPatchFromWeb', () => {
  it('an empty patch is valid and changes nothing', () => {
    expect(settingsPatchFromWeb({})).toEqual({ ok: true, patch: {} });
  });

  it('names the field it refused', () => {
    expect(settingsPatchFromWeb({ lang: 'de' })).toEqual({ ok: false, field: 'lang' });
    expect(settingsPatchFromWeb({ lang: 'en', calendarAlerts: 'maybe' })).toEqual({ ok: false, field: 'calendarAlerts' });
  });
});

describe('newInvite', () => {
  it('a week by default, from the given instant', () => {
    const now = new Date('2026-11-04T00:00:00Z');
    const inv = newInvite(now);
    expect(inv.expiresAt.getTime() - now.getTime()).toBe(INVITE_TTL_MS);
    expect(inv.code.length).toBe(16);
  });
});

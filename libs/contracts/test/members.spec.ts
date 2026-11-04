import { WebMemberSchema, WebMemberSettingsPatchSchema, WebMembersResponseSchema } from '../src/insight';

/** IB-035 — the members and settings contracts. */
describe('members contracts', () => {
  const member = { id: 2, tgUserId: 900, login: null, role: 'member', disabled: false, createdAt: 1, lastLoginAt: null, activeSessions: 0 };

  it('a member with no password has login null, and the list carries no invite link', () => {
    expect(WebMembersResponseSchema.parse({ members: [member] }).members[0].login).toBeNull();
    expect(Object.keys(WebMemberSchema.shape)).not.toContain('link');
  });

  it('the settings PATCH is strict: an unknown field is refused, not ignored', () => {
    expect(WebMemberSettingsPatchSchema.safeParse({ lang: 'en' }).success).toBe(true);
    expect(WebMemberSettingsPatchSchema.safeParse({ calendarAlerts: 'off' }).success).toBe(true);
    expect(WebMemberSettingsPatchSchema.safeParse({ lang: 'en', deposit: 1000 }).success).toBe(false);
    expect(WebMemberSettingsPatchSchema.safeParse({ riskPct: 1 }).success).toBe(false);
  });
});

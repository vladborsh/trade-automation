import type { WebMember } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { refusalKey, toMemberRow } from './member-rows';

const m = (over: Partial<WebMember> = {}): WebMember => ({
  id: 2, tgUserId: 900, login: 'alice', role: 'member', disabled: false,
  createdAt: Date.UTC(2026, 10, 3, 23, 59), lastLoginAt: Date.UTC(2026, 10, 4, 1, 2, 3), activeSessions: 2, ...over,
});

describe('toMemberRow (IB-035)', () => {
  it('an active member: «disable» on the button, UTC dates, live sessions', () => {
    expect(toMemberRow(m(), 1)).toEqual({
      id: 2, tgUserId: 900, login: 'alice', role: 'members.role.member', disabled: false,
      joined: '2026-11-03', lastLogin: '2026-11-04 01:02', sessions: 2, action: 'disable',
    });
  });

  it('a disabled member offers «enable»; no password and no sign-in show dashes, not blanks', () => {
    const row = toMemberRow(m({ disabled: true, login: null, lastLoginAt: null }), 1);
    expect(row.action).toBe('enable');
    expect([row.login, row.lastLogin]).toEqual(['—', '—']);
  });

  it('the admin\'s own row has no button: the server would refuse it (409)', () => {
    expect(toMemberRow(m({ id: 1, role: 'admin' }), 1).action).toBeNull();
  });
});

describe('refusalKey', () => {
  it('maps each 409 code to its sentence, and anything else to the generic failure', () => {
    expect(refusalKey('CANNOT_DISABLE_SELF')).toBe('members.refused.self');
    expect(refusalKey('LAST_ADMIN')).toBe('members.refused.lastAdmin');
    expect(refusalKey('BOT_NOT_CONFIGURED')).toBe('members.refused.noBot');
    expect(refusalKey('SOMETHING')).toBe('members.failed');
    expect(refusalKey(undefined)).toBe('members.failed');
  });
});

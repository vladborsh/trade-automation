import type { WebMember } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { refusalKey, toMemberRow } from './member-rows';
import { dateTime, dayMonthYear } from '../../shared/time-format';

describe('toMemberRow zones (IB-152)', () => {
  it('23:59 UTC on the 3rd joined on the 4th in Kyiv', () => {
    const row = (zone: string) => toMemberRow(m(), 1, zone);
    expect([row('UTC').joined, row('Europe/Kyiv').joined]).toEqual(['03.11.2026', '04.11.2026']);
    expect([row('UTC').lastLogin, row('Europe/Kyiv').lastLogin]).toEqual(['04.11 01:02', '04.11 03:02']);
  });
});

const m = (over: Partial<WebMember> = {}): WebMember => ({
  id: 2, tgUserId: 900, login: 'alice', role: 'member', disabled: false,
  createdAt: Date.UTC(2026, 10, 3, 23, 59), lastLoginAt: Date.UTC(2026, 10, 4, 1, 2, 3), activeSessions: 2, ...over,
});

describe('toMemberRow (IB-035)', () => {
  it('an active member: «disable» on the button, the viewer\'s dates (IB-152), live sessions', () => {
    expect(toMemberRow(m(), 1)).toEqual({
      id: 2, tgUserId: 900, login: 'alice', role: 'members.role.member', disabled: false,
      joined: dayMonthYear(Date.UTC(2026, 10, 3, 23, 59) / 1000), lastLogin: dateTime(Date.UTC(2026, 10, 4, 1, 2, 3) / 1000), sessions: 2, action: 'disable',
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

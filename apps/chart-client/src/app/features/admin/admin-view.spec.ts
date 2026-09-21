import type { AdminInvite, AdminUser } from '@trade-automation/contracts';
import { ApiError } from '../../core/api/api-error';
import { adminErrorMessage, canDisable, canRevoke, formatUtc, inviteStatus, parseInviteEmail, usedByEmail } from './admin-view';

const NOW = Date.UTC(2026, 8, 21, 12, 0);
const invite = (over: Partial<AdminInvite> = {}): AdminInvite => ({
  id: 'i1', email: null, createdAt: NOW - 1000, expiresAt: NOW + 1000, usedAt: null, usedBy: null, ...over,
});
const user = (over: Partial<AdminUser> = {}): AdminUser => ({
  id: 'u1', email: 'a@example.com', role: 'user', createdAt: NOW, disabledAt: null, ...over,
});

describe('admin-view helpers', () => {
  it('inviteStatus: used wins over expiry; expired at or after expiresAt; otherwise open', () => {
    expect(inviteStatus(invite(), NOW)).toBe('open');
    expect(inviteStatus(invite({ expiresAt: NOW }), NOW)).toBe('expired');
    expect(inviteStatus(invite({ usedAt: NOW - 10, expiresAt: NOW - 5 }), NOW)).toBe('used');
  });

  it('canRevoke: any unused invite, expired included; never a used one', () => {
    expect(canRevoke(invite())).toBe(true);
    expect(canRevoke(invite({ expiresAt: NOW - 1 }))).toBe(true);
    expect(canRevoke(invite({ usedAt: NOW }))).toBe(false);
  });

  it('canDisable: not yourself, not someone already disabled', () => {
    expect(canDisable(user(), 'admin')).toBe(true);
    expect(canDisable(user({ id: 'admin' }), 'admin')).toBe(false);
    expect(canDisable(user({ disabledAt: NOW }), 'admin')).toBe(false);
  });

  it('usedByEmail resolves the accepting user when listed', () => {
    const users = [user({ id: 'u9', email: 'new@example.com' })];
    expect(usedByEmail(invite({ usedBy: 'u9' }), users)).toBe('new@example.com');
    expect(usedByEmail(invite({ usedBy: 'gone' }), users)).toBeNull();
    expect(usedByEmail(invite(), users)).toBeNull();
  });

  it('formatUtc', () => {
    expect(formatUtc(NOW)).toBe('2026-09-21 12:00 UTC');
    expect(formatUtc(null)).toBe('—');
  });

  it('parseInviteEmail: blank means no email; otherwise the contract email rule', () => {
    expect(parseInviteEmail('  ')).toEqual({ ok: true });
    expect(parseInviteEmail(' new@example.com ')).toEqual({ ok: true, email: 'new@example.com' });
    expect(parseInviteEmail('not-an-email')).toEqual({ ok: false });
  });

  it('adminErrorMessage maps statuses and codes per action', () => {
    expect(adminErrorMessage('disable', new ApiError(409, null, 'x'))).toBe('You cannot disable your own account.');
    expect(adminErrorMessage('revoke', new ApiError(409, 'INVITE_USED', 'x'))).toContain('already been used');
    expect(adminErrorMessage('revoke', new ApiError(404, null, 'x'))).toBe('That invite no longer exists.');
    expect(adminErrorMessage('create', new ApiError(400, null, 'x'))).toBe('That email address is not valid.');
    expect(adminErrorMessage('load', new ApiError(403, null, 'x'))).toBe('Only an administrator can do this.');
    expect(adminErrorMessage('load', new ApiError(500, null, 'x'))).toBe('Could not load users and invites. Try again.');
    expect(adminErrorMessage('enable', new TypeError('fetch failed'))).toContain('Cannot reach the server');
  });
});

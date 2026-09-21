import { inviteStatus } from '../../src/auth/invite-status';

describe('inviteStatus (backtest-app-system-design.md §7.1)', () => {
  const now = 1_000_000;

  it('classifies unknown / used / expired / valid', () => {
    expect(inviteStatus(null, now)).toBe('unknown');
    expect(inviteStatus({ usedAtMs: null, expiresAtMs: now + 1 }, now)).toBe('valid');
    expect(inviteStatus({ usedAtMs: null, expiresAtMs: now }, now)).toBe('expired');
    expect(inviteStatus({ usedAtMs: now - 5, expiresAtMs: now + 1 }, now)).toBe('used');
  });

  it('reports a used invite that has since expired as used', () => {
    expect(inviteStatus({ usedAtMs: now - 10, expiresAtMs: now - 1 }, now)).toBe('used');
  });
});

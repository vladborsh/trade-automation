import { CODE_LENGTH, generateInviteCode, inviteLink, isWellFormedCode } from '../../src/users/invite-code';

/** IB-021 §3.5 — the code is the only thing between a stranger and membership. */

describe('generateInviteCode', () => {
  it('produces a well-formed code of the stated length', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isWellFormedCode(code)).toBe(true);
    }
  });

  it('never emits characters that are misread when a link is retyped', () => {
    const codes = Array.from({ length: 200 }, () => generateInviteCode()).join('');
    expect(codes).not.toMatch(/[01loi]/i);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateInviteCode()));
    expect(seen.size).toBe(500);
  });

  it('uses the whole alphabet — a biased or truncated generator would show here', () => {
    const codes = Array.from({ length: 400 }, () => generateInviteCode()).join('');
    expect(new Set(codes).size).toBe(31);
  });
});

describe('isWellFormedCode', () => {
  it('rejects anything that is not one of our codes', () => {
    expect(isWellFormedCode('')).toBe(false);
    expect(isWellFormedCode('short')).toBe(false);
    expect(isWellFormedCode('A'.repeat(16))).toBe(false); // uppercase is not in the alphabet
    expect(isWellFormedCode('abcdefghjkmnpqr0')).toBe(false); // '0' is excluded
    expect(isWellFormedCode(`${generateInviteCode()}x`)).toBe(false);
  });
});

describe('inviteLink', () => {
  it('is the deep link §3.5 specifies', () => {
    expect(inviteLink('insight_test_bot', 'abcdefghjkmnpqrs'))
      .toBe('https://t.me/insight_test_bot?start=abcdefghjkmnpqrs');
  });
});

import { isAcceptablePassword, isValidLogin, normalizeLogin } from '../../../src/web/auth/credential-rules';

describe('login rules (P4)', () => {
  it('lower-cases before checking, so Ann and ann are one login', () => {
    expect(normalizeLogin('Ann.Smith')).toBe('ann.smith');
    expect(isValidLogin(normalizeLogin('Ann.Smith'))).toBe(true);
  });

  it('ASCII [a-z0-9._-], 3–32, starting with a letter or digit', () => {
    for (const ok of ['ann', '0xff', 'a.b_c-d', 'a'.repeat(32)]) expect(isValidLogin(ok)).toBe(true);
    for (const bad of ['an', 'a'.repeat(33), '.ann', '-ann', 'an n', 'аnn' /* Cyrillic а */, 'ann@x', '']) expect(isValidLogin(bad)).toBe(false);
  });
});

describe('password rule (P6)', () => {
  it('10–128 characters, counted as characters not UTF-16 units', () => {
    expect(isAcceptablePassword('x'.repeat(9), 'ann')).toBe(false);
    expect(isAcceptablePassword('x'.repeat(10), 'ann')).toBe(true);
    expect(isAcceptablePassword('x'.repeat(128), 'ann')).toBe(true);
    expect(isAcceptablePassword('x'.repeat(129), 'ann')).toBe(false);
    expect(isAcceptablePassword('🙂'.repeat(10), 'ann')).toBe(true); // 10 characters, 20 UTF-16 units
    // 5 characters but 10 UTF-16 units: a `.length` check would wrongly accept this
    expect(isAcceptablePassword('🙂'.repeat(5), 'ann')).toBe(false);
  });

  it('not equal to the login, case-insensitively; no composition rules', () => {
    expect(isAcceptablePassword('ann.smith1', 'ann.smith1')).toBe(false);
    expect(isAcceptablePassword('Ann.Smith1', 'ann.smith1')).toBe(false);
    expect(isAcceptablePassword('aaaaaaaaaa', 'ann.smith1')).toBe(true);
  });
});

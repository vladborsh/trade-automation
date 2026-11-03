import { WEB_PASSWORD_MAX, WEB_PASSWORD_MIN } from '@trade-automation/contracts';
import { loginProblem, normalizeLogin, passwordProblem } from './auth-rules';

describe('auth-rules (IB-079, the server\'s numbers)', () => {
  it('uses the contract bounds 10..128', () => {
    expect([WEB_PASSWORD_MIN, WEB_PASSWORD_MAX]).toEqual([10, 128]);
  });

  it('a login is checked as the server stores it: lower-cased', () => {
    expect(normalizeLogin('Ann.Smith')).toBe('ann.smith');
    expect(loginProblem('Ann.Smith')).toBeNull();
    for (const bad of ['an', '.ann', 'аnn' /* Cyrillic а */, 'a b', 'a'.repeat(33)]) expect(loginProblem(bad)).toBe('login.bad');
  });

  it('password: length in characters, not equal to the login, and the repeat must match', () => {
    expect(passwordProblem('x'.repeat(9), 'x'.repeat(9), 'ann')).toBe('password.short');
    expect(passwordProblem('🙂'.repeat(5), '🙂'.repeat(5), 'ann')).toBe('password.short'); // 10 UTF-16 units, 5 characters
    expect(passwordProblem('x'.repeat(129), 'x'.repeat(129), 'ann')).toBe('password.long');
    expect(passwordProblem('Ann.Smith1', 'Ann.Smith1', 'ann.smith1')).toBe('password.sameAsLogin');
    expect(passwordProblem('long enough 1', 'long enough 2', 'ann')).toBe('password.mismatch');
    expect(passwordProblem('long enough 1', 'long enough 1', 'ann')).toBeNull();
  });
});

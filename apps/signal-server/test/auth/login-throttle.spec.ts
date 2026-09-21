import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, LoginThrottle } from '../../src/auth/login-throttle';

describe('LoginThrottle (backtest-app-system-design.md §7.1: 10 failures / email / 15 min)', () => {
  const t0 = 1_000_000;

  it('blocks after the 10th failure inside the window, per email, case-insensitively', () => {
    const throttle = new LoginThrottle();
    expect(LOGIN_MAX_FAILURES).toBe(10);
    for (let i = 0; i < 9; i++) throttle.recordFailure('A@x.test', t0 + i);
    expect(throttle.isBlocked('a@x.test', t0 + 10)).toBe(false);
    throttle.recordFailure('a@X.test', t0 + 10);
    expect(throttle.isBlocked('a@x.test', t0 + 11)).toBe(true);
    expect(throttle.isBlocked('b@x.test', t0 + 11)).toBe(false);
  });

  it('is a sliding window: failures older than 15 minutes stop counting', () => {
    const throttle = new LoginThrottle();
    expect(LOGIN_WINDOW_MS).toBe(15 * 60 * 1000);
    for (let i = 0; i < 10; i++) throttle.recordFailure('a@x.test', t0 + i * 1000);
    expect(throttle.isBlocked('a@x.test', t0 + LOGIN_WINDOW_MS - 1)).toBe(true);
    // the first failure (t0) has aged out; nine remain
    expect(throttle.isBlocked('a@x.test', t0 + LOGIN_WINDOW_MS)).toBe(false);
  });

  it('reset clears the record (a successful login)', () => {
    const throttle = new LoginThrottle(2, 1000);
    throttle.recordFailure('a@x.test', t0);
    throttle.recordFailure('a@x.test', t0);
    expect(throttle.isBlocked('a@x.test', t0)).toBe(true);
    throttle.reset('A@x.test');
    expect(throttle.isBlocked('a@x.test', t0)).toBe(false);
  });
});

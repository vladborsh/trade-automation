import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, LoginThrottle } from '../../src/auth/login-throttle';

describe('LoginThrottle (design §7.1: 10 failures / email / 15 min; BUG-005: reserve before verifying)', () => {
  const t0 = 1_000_000;

  it('admits 10 attempts in flight or failed, refuses the 11th, per email, case-insensitively', () => {
    const throttle = new LoginThrottle();
    expect(LOGIN_MAX_FAILURES).toBe(10);
    const held = Array.from({ length: 10 }, (_, i) => throttle.tryReserve(i % 2 ? 'A@x.test' : ' a@x.test ', t0 + i));
    expect(held.every((r) => r !== null)).toBe(true);
    // none of the 10 has finished yet: in-flight attempts count
    expect(throttle.tryReserve('a@X.test', t0 + 10)).toBeNull();
    expect(throttle.isBlocked('a@x.test', t0 + 10)).toBe(true);
    expect(throttle.tryReserve('b@x.test', t0 + 10)).not.toBeNull();
  });

  it('a failure keeps its reservation; a neutral outcome releases only its own', () => {
    const throttle = new LoginThrottle(3, 1000);
    const a = throttle.tryReserve('u@x.test', t0)!; // will fail: kept
    const b = throttle.tryReserve('u@x.test', t0)!; // neutral: released
    const c = throttle.tryReserve('u@x.test', t0)!; // will fail: kept
    expect(throttle.tryReserve('u@x.test', t0)).toBeNull();
    throttle.release(b);
    expect(throttle.isBlocked('u@x.test', t0)).toBe(false);
    const d = throttle.tryReserve('u@x.test', t0);
    expect(d).not.toBeNull();
    expect(throttle.tryReserve('u@x.test', t0)).toBeNull(); // a, c, d
    throttle.release(b); // releasing twice is harmless
    expect(throttle.isBlocked('u@x.test', t0)).toBe(true);
    void a;
    void c;
  });

  it('a success clears the record, even with other attempts interleaved', () => {
    const throttle = new LoginThrottle(2, 1000);
    throttle.tryReserve('u@x.test', t0);
    throttle.tryReserve('u@x.test', t0);
    expect(throttle.tryReserve('u@x.test', t0)).toBeNull();
    throttle.reset('U@x.test');
    expect(throttle.tryReserve('u@x.test', t0)).not.toBeNull();
  });

  it('is a sliding window: attempts older than 15 minutes stop counting', () => {
    const throttle = new LoginThrottle();
    expect(LOGIN_WINDOW_MS).toBe(15 * 60 * 1000);
    for (let i = 0; i < 10; i++) throttle.tryReserve('a@x.test', t0 + i * 1000);
    expect(throttle.tryReserve('a@x.test', t0 + LOGIN_WINDOW_MS - 1)).toBeNull();
    // the first attempt (t0) has aged out; nine remain, so one more is admitted
    expect(throttle.tryReserve('a@x.test', t0 + LOGIN_WINDOW_MS)).not.toBeNull();
    expect(throttle.tryReserve('a@x.test', t0 + LOGIN_WINDOW_MS)).toBeNull();
  });
});

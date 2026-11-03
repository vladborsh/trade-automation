import { IP_MAX_FAILURES, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, LoginGuard, LoginThrottle } from '../../../src/web/auth/login-throttle';

describe('LoginThrottle (P7, copied from signal-server incl. BUG-005)', () => {
  it('10 per login / 15 min, 30 per IP', () => {
    expect([LOGIN_MAX_FAILURES, IP_MAX_FAILURES, LOGIN_WINDOW_MS]).toEqual([10, 30, 900_000]);
  });

  it('reserves BEFORE the check: 10 concurrent attempts fill the window, the 11th is refused', () => {
    const t = new LoginThrottle(10);
    const held = Array.from({ length: 10 }, () => t.tryReserve('ann', 0));
    expect(held.every((r) => r !== null)).toBe(true);
    expect(t.tryReserve('ann', 1)).toBeNull();
    expect(t.tryReserve('bob', 1)).not.toBeNull(); // per key
  });

  it('the window slides: after 15 minutes the old failures no longer count', () => {
    const t = new LoginThrottle(10);
    for (let i = 0; i < 10; i++) t.tryReserve('ann', 0);
    expect(t.tryReserve('ann', LOGIN_WINDOW_MS - 1)).toBeNull();
    expect(t.tryReserve('ann', LOGIN_WINDOW_MS)).not.toBeNull();
  });

  it('release frees only its own reservation; reset clears the key', () => {
    const t = new LoginThrottle(2);
    const a = t.tryReserve('ann', 0)!;
    t.tryReserve('ann', 0);
    expect(t.tryReserve('ann', 0)).toBeNull();
    t.release(a);
    expect(t.tryReserve('ann', 0)).not.toBeNull();
    t.reset('ann');
    expect(t.tryReserve('ann', 0)).not.toBeNull();
  });
});

describe('LoginGuard — both keys', () => {
  it('a full IP refuses a fresh login and leaves that login with no reservation', () => {
    const g = new LoginGuard(new LoginThrottle(10), new LoginThrottle(2));
    g.tryReserve('a1', '1.1.1.1', 0);
    g.tryReserve('a2', '1.1.1.1', 0);
    expect(g.tryReserve('a3', '1.1.1.1', 0)).toBeNull();
    // a3's login key must not have kept the reservation the IP refusal undid
    for (let i = 0; i < 10; i++) expect(g.tryReserve('a3', `2.2.2.${i}`, 0)).not.toBeNull();
  });

  it('success clears the login and frees only this attempt on the IP', () => {
    const g = new LoginGuard(new LoginThrottle(10), new LoginThrottle(3));
    g.tryReserve('x', '9.9.9.9', 0);
    g.tryReserve('y', '9.9.9.9', 0);
    const ok = g.tryReserve('ann', '9.9.9.9', 0)!;
    g.succeeded(ok);
    expect(g.tryReserve('z', '9.9.9.9', 0)).not.toBeNull(); // ann's slot freed…
    expect(g.tryReserve('w', '9.9.9.9', 0)).toBeNull(); // …x and y still count
  });
});

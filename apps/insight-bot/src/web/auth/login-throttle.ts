/**
 * IB-078 P7 — brute-force throttle for the site login. **COPIED from
 * `apps/signal-server/src/auth/login-throttle.ts`** (not imported), generalised from "an email" to
 * "a key", and used twice: per login (10 failures / 15 min) and per client IP (30 / 15 min).
 *
 * BUG-005 (the reason this is copied rather than rewritten): an attempt is **reserved before the
 * password is checked**, synchronously, so concurrent requests for one key see each other. At most
 * `maxFailures` attempts may be in flight or failed inside the window; the next one is refused before
 * any scrypt runs. A wrong password leaves its reservation in place as the failure; a success clears
 * the login's record; a neutral outcome (unexpected error) releases just its own reservation.
 *
 * Accepted trade-off (design P7): anyone can lock a login for 15 minutes by failing 10 times. The
 * journal shows it.
 */
export const LOGIN_MAX_FAILURES = 10;
export const IP_MAX_FAILURES = 30;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** One reserved attempt; pass it back to `release` for a neutral outcome. */
export interface LoginReservation {
  readonly key: string;
  readonly at: number;
}

export class LoginThrottle {
  private readonly attempts = new Map<string, LoginReservation[]>();

  constructor(
    private readonly maxFailures = LOGIN_MAX_FAILURES,
    private readonly windowMs = LOGIN_WINDOW_MS,
  ) {}

  /**
   * Reserves an attempt for `key`, or returns null (refuse with 429) when `maxFailures` attempts are
   * already in flight or failed inside the window ending at `nowMs`. Synchronous: nothing can
   * interleave between the check and the reservation.
   */
  tryReserve(key: string, nowMs: number): LoginReservation | null {
    const recent = this.recent(key, nowMs);
    if (recent.length >= this.maxFailures) return null;
    const reservation: LoginReservation = { key, at: nowMs };
    this.attempts.set(key, [...recent, reservation]);
    return reservation;
  }

  /** A neutral outcome: removes this reservation only (a failure simply keeps it). */
  release(reservation: LoginReservation): void {
    const list = this.attempts.get(reservation.key);
    if (!list) return;
    const kept = list.filter((r) => r !== reservation);
    if (kept.length === 0) this.attempts.delete(reservation.key);
    else this.attempts.set(reservation.key, kept);
  }

  /** A successful login clears the key's record. */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  /** Attempts still inside the window; prunes the stale ones (and the entry, once empty). */
  private recent(key: string, nowMs: number): LoginReservation[] {
    const kept = (this.attempts.get(key) ?? []).filter((r) => nowMs - r.at < this.windowMs);
    if (kept.length === 0) this.attempts.delete(key);
    else this.attempts.set(key, kept);
    return kept;
  }
}

/** Both keys of P7 at once: either one full → refused, and neither keeps a reservation. */
export class LoginGuard {
  constructor(
    readonly byLogin = new LoginThrottle(LOGIN_MAX_FAILURES),
    readonly byIp = new LoginThrottle(IP_MAX_FAILURES),
  ) {}

  tryReserve(login: string, ip: string, nowMs: number): { login: LoginReservation; ip: LoginReservation } | null {
    const l = this.byLogin.tryReserve(login, nowMs);
    if (!l) return null;
    const i = this.byIp.tryReserve(ip, nowMs);
    if (!i) {
      this.byLogin.release(l);
      return null;
    }
    return { login: l, ip: i };
  }

  /** Success: the login's record is cleared; the IP keeps other logins' failures, minus this attempt. */
  succeeded(r: { login: LoginReservation; ip: LoginReservation }): void {
    this.byLogin.reset(r.login.key);
    this.byIp.release(r.ip);
  }

  /** Neither success nor a wrong password (an unexpected error): the attempt does not count. */
  release(r: { login: LoginReservation; ip: LoginReservation }): void {
    this.byLogin.release(r.login);
    this.byIp.release(r.ip);
  }
}

/**
 * architecture/backtest-app-system-design.md §7.1 — "Login is rate-limited in memory to 10
 * failures per email per 15 minutes (429 `TOO_MANY_ATTEMPTS`) — cheap, and enough for a closed
 * contour." Sliding window per lower-cased email (known or unknown); in-memory and per-process,
 * accepted by the design for a single-instance closed contour.
 *
 * BUG-005: an attempt is **reserved before the password is checked**, synchronously, so
 * concurrent requests for one email see each other. At most `maxFailures` attempts may be in
 * flight or failed inside the window; the next one is refused before any scrypt runs. A wrong
 * password leaves its reservation in place as the failure; a success clears the email's record;
 * a neutral outcome (disabled account, unexpected error) releases just its own reservation.
 *
 * Accepted trade-off (design §7.1): the key is the email alone, so anyone can lock an account's
 * logins for 15 minutes by failing 10 times.
 */
export const LOGIN_MAX_FAILURES = 10;
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
   * Reserves an attempt for `email`, or returns null (refuse with 429) when `maxFailures`
   * attempts are already in flight or failed inside the window ending at `nowMs`. Synchronous:
   * nothing can interleave between the check and the reservation.
   */
  tryReserve(email: string, nowMs: number): LoginReservation | null {
    const recent = this.recent(key(email), nowMs);
    if (recent.length >= this.maxFailures) return null;
    const reservation: LoginReservation = { key: key(email), at: nowMs };
    this.attempts.set(reservation.key, [...recent, reservation]);
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

  /** A successful login clears the email's record. */
  reset(email: string): void {
    this.attempts.delete(key(email));
  }

  /** True when the next `tryReserve` for this email would be refused. */
  isBlocked(email: string, nowMs: number): boolean {
    return this.recent(key(email), nowMs).length >= this.maxFailures;
  }

  /** Attempts still inside the window; prunes the stale ones (and the entry, once empty). */
  private recent(k: string, nowMs: number): LoginReservation[] {
    const kept = (this.attempts.get(k) ?? []).filter((r) => nowMs - r.at < this.windowMs);
    if (kept.length === 0) this.attempts.delete(k);
    else this.attempts.set(k, kept);
    return kept;
  }
}

function key(email: string): string {
  return email.trim().toLowerCase();
}

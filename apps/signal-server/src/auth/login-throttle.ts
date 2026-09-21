/**
 * architecture/backtest-app-system-design.md §7.1 — "Login is rate-limited in memory to 10
 * failures per email per 15 minutes (429 `TOO_MANY_ATTEMPTS`) — cheap, and enough for a closed
 * contour." Sliding window of failure timestamps per lower-cased email; a successful login
 * clears the email's record. In-memory, so it resets on restart and is per-process — accepted
 * by the design for a single-instance closed contour.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = LOGIN_MAX_FAILURES,
    private readonly windowMs = LOGIN_WINDOW_MS,
  ) {}

  /** True once `maxFailures` failures for this email fall inside the window ending at `nowMs`. */
  isBlocked(email: string, nowMs: number): boolean {
    return this.recent(email, nowMs).length >= this.maxFailures;
  }

  recordFailure(email: string, nowMs: number): void {
    const recent = this.recent(email, nowMs);
    recent.push(nowMs);
    this.failures.set(key(email), recent);
  }

  reset(email: string): void {
    this.failures.delete(key(email));
  }

  /** Failures still inside the window; prunes the stale ones (and the entry, once empty). */
  private recent(email: string, nowMs: number): number[] {
    const k = key(email);
    const kept = (this.failures.get(k) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (kept.length === 0) this.failures.delete(k);
    else this.failures.set(k, kept);
    return kept;
  }
}

function key(email: string): string {
  return email.trim().toLowerCase();
}

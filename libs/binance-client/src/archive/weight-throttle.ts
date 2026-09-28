/**
 * IB-012 — the REST tail's weight throttle (§5, D15).
 *
 * The archive is free; the REST tail is not. Two independent limits, because they fail
 * differently:
 *
 * - **Our own budget, 600 weight/min.** A rolling 60-second window of what we spent. This is the
 *   promise the design makes to the rest of the app (steady state is ~32/min, so a backfill must
 *   not eat the live collectors' headroom) and it holds even if Binance never says a word.
 * - **The venue's own count, `X-MBX-USED-WEIGHT-1M`.** Above 1200 we stop until the minute rolls
 *   over, whatever our own tally says — another process on the same IP may be spending too, and
 *   the header is the only thing that knows about it.
 *
 * Callers `await acquire(weight)` before a request and `observeHeader(...)` after one. The clock
 * and the sleep are injected so the specs are instant and deterministic.
 */

export interface WeightThrottleOptions {
  /** Our own ceiling per rolling minute (§5: 600). */
  budgetPerMin?: number;
  /** Venue-reported used weight above which we stop until the minute rolls over (§5: 1200). */
  headerCeiling?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MINUTE_MS = 60_000;
export const DEFAULT_BUDGET_PER_MIN = 600;
export const DEFAULT_HEADER_CEILING = 1200;

interface Spend {
  at: number;
  weight: number;
}

export class WeightThrottle {
  private readonly budget: number;
  private readonly headerCeiling: number;
  private readonly now: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private spends: Spend[] = [];
  private blockedUntil = 0;
  /** Total milliseconds spent waiting — reported, so a slow run can explain itself. */
  private waitedMs = 0;

  constructor(options: WeightThrottleOptions = {}) {
    this.budget = options.budgetPerMin ?? DEFAULT_BUDGET_PER_MIN;
    this.headerCeiling = options.headerCeiling ?? DEFAULT_HEADER_CEILING;
    this.now = options.now ?? Date.now;
    this.sleepFn = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Waits until `weight` more can be spent, then records it as spent. */
  async acquire(weight: number): Promise<void> {
    for (;;) {
      const now = this.now();
      this.trim(now);

      if (now < this.blockedUntil) {
        await this.wait(this.blockedUntil - now);
        continue;
      }
      const used = this.used();
      if (used + weight <= this.budget) {
        this.spends.push({ at: now, weight });
        return;
      }
      // wait for the oldest spend to leave the rolling window
      const oldest = this.spends[0];
      await this.wait(oldest ? oldest.at + MINUTE_MS - now : MINUTE_MS);
    }
  }

  /**
   * The venue's own figure, from `X-MBX-USED-WEIGHT-1M`. Above the ceiling we hold off until the
   * next minute boundary — not for a fixed delay, because the venue's counter is per clock minute.
   */
  observeHeader(usedWeight1m: number | null | undefined): void {
    if (typeof usedWeight1m !== 'number' || !Number.isFinite(usedWeight1m)) return;
    if (usedWeight1m > this.headerCeiling) {
      const now = this.now();
      this.blockedUntil = Math.max(this.blockedUntil, now + (MINUTE_MS - (now % MINUTE_MS)));
    }
  }

  /** Weight spent in the last rolling minute. */
  used(): number {
    this.trim(this.now());
    return this.spends.reduce((sum, s) => sum + s.weight, 0);
  }

  get totalWaitedMs(): number {
    return this.waitedMs;
  }

  private async wait(ms: number): Promise<void> {
    const capped = Math.max(1, Math.min(ms, MINUTE_MS));
    this.waitedMs += capped;
    await this.sleepFn(capped);
  }

  private trim(now: number): void {
    this.spends = this.spends.filter((s) => now - s.at < MINUTE_MS);
  }
}

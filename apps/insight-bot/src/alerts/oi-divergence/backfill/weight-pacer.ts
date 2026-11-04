/**
 * IB-116 (design V31) — keeps a one-off run under a weight budget per minute: before each call of weight
 * `w`, waits until the calls of the trailing 60 s plus `w` fit in `perMinute`. A trailing window, not a
 * calendar minute: no 60 s anywhere in the run holds more than the budget, whichever minute the venue counts.
 *
 * Pure apart from its two seams (`now`, `sleep`), so a spec drives it on a fake clock.
 */
export class WeightPacer {
  private readonly calls: Array<{ at: number; weight: number }> = [];
  private spent = 0;

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    if (!(perMinute > 0)) throw new Error(`perMinute must be positive, got ${perMinute}`);
  }

  /** Waits until a call of `weight` fits, then counts it. A single call above the budget is refused. */
  async take(weight: number): Promise<void> {
    if (weight > this.perMinute) throw new Error(`one call of weight ${weight} exceeds the ${this.perMinute}/min budget`);
    for (;;) {
      const t = this.now();
      while (this.calls.length > 0 && t - (this.calls[0] as { at: number }).at >= 60_000) this.calls.shift();
      const used = this.calls.reduce((sum, c) => sum + c.weight, 0);
      if (used + weight <= this.perMinute) {
        this.calls.push({ at: t, weight });
        this.spent += weight;
        return;
      }
      // the oldest call leaves the window first; wait for it (and retry: one may not free enough)
      await this.sleep((this.calls[0] as { at: number }).at + 60_000 - t);
    }
  }

  /** Total weight counted so far. */
  get total(): number {
    return this.spent;
  }
}

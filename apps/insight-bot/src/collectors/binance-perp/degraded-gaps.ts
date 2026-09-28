/**
 * IB-005 / §16.1 — `!forceOrder` has no REST equivalent, so **every liquidation during a degraded
 * spell is lost**. That loss must be visible, not silent: each spell becomes `collector_gaps` rows
 * with `repaired = 0`.
 *
 * One row per spell would hide a spell that outlives the day (the 00:10 gap report reads one UTC
 * day), so a spell that crosses midnight is cut at the boundary: one row per day of degradation,
 * each closed and written as soon as it ends.
 */
export interface DegradedSpan {
  from: number;
  to: number;
}

const DAY_MS = 86_400_000;

/** The UTC midnight strictly after `ms`. */
export function nextUtcMidnight(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS + DAY_MS;
}

export class DegradedGapTracker {
  private start: number | null = null;

  get open(): boolean {
    return this.start !== null;
  }

  get openedAt(): number | null {
    return this.start;
  }

  /** Degraded mode began. Idempotent: a second call while open changes nothing. */
  begin(now: number): void {
    if (this.start === null) this.start = now;
  }

  /**
   * Call on every tick: returns the spans finished by crossing UTC midnight (usually none), and
   * keeps the spell open from the boundary.
   */
  rollDay(now: number): DegradedSpan[] {
    const spans: DegradedSpan[] = [];
    while (this.start !== null && now >= nextUtcMidnight(this.start)) {
      const boundary = nextUtcMidnight(this.start);
      spans.push({ from: this.start, to: boundary });
      this.start = boundary;
    }
    return spans;
  }

  /** The spell ended (recovery or shutdown): the final span, or null if none was open. */
  end(now: number): DegradedSpan | null {
    if (this.start === null) return null;
    const span = { from: this.start, to: Math.max(now, this.start) };
    this.start = null;
    return span;
  }
}

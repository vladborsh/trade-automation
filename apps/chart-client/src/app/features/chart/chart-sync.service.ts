import { Injectable, signal } from '@angular/core';

/** Seconds-based visible time range, as `lightweight-charts`' `getVisibleRange()` returns it. */
export interface TimeRange {
  from: number;
  to: number;
}

/**
 * True when both ranges are within `epsilonSec` of each other on both ends.
 * `null` never equals a real range (nothing has been applied/proposed yet).
 */
export function sameRange(a: TimeRange | null, b: TimeRange | null, epsilonSec: number): boolean {
  if (!a || !b) {
    return false;
  }
  return Math.abs(a.from - b.from) <= epsilonSec && Math.abs(a.to - b.to) <= epsilonSec;
}

/**
 * architecture/chart-layouts.md §6.4 — time-based (not bar-index) scroll/zoom
 * sync across the panels of one grid. One instance per `PanelGridComponent`
 * (provided in its own `providers: []`, not root) so tests can instantiate
 * it in isolation and so switching layouts gets a fresh, unpolluted range.
 *
 * Only USER gestures (wheel/drag/keyboard) on a chart's own time scale
 * produce a `propose()` call — see `ChartComponent`'s drive/follow wiring
 * (§6.4). This service holds no knowledge of "user gesture" itself; the two
 * reentrancy guards that make that true live in `ChartComponent`:
 *
 * - The synchronous `applying` flag suppresses the range-change callback
 *   fired by the follower's own `setVisibleRange()` call.
 * - The `lastApplied` + epsilon guard suppresses the callback if the
 *   library fires it asynchronously (next frame), and suppresses the
 *   "snap echo" where a follower's own bar grid snaps the requested window
 *   to a slightly different one, which would otherwise re-propose and move
 *   the driver — an infinite bounce. `epsilonSec` (half a bar) is larger
 *   than any such snap.
 */
@Injectable()
export class ChartSyncService {
  private readonly _range = signal<TimeRange | null>(null);
  private readonly _origin = signal<string | null>(null);

  readonly range = this._range.asReadonly();
  readonly origin = this._origin.asReadonly();

  /** Called by a panel's `ChartComponent` on a visible-time-range change it did not itself apply. */
  propose(panelId: string, range: TimeRange, epsilonSec: number): void {
    const cur = this._range();
    if (cur && sameRange(cur, range, epsilonSec)) {
      return; // drift guard: not a meaningfully different range, do not re-propose/re-broadcast
    }
    this._origin.set(panelId);
    this._range.set(range);
  }

  /** Called on layout/timeframe rebuild — the new panels start with no shared range. */
  reset(): void {
    this._range.set(null);
    this._origin.set(null);
  }
}

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
/**
 * Circuit breaker (§6.4 belt-and-suspenders backstop, see
 * architecture/scroll-back-freeze-diagnosis.md): if the per-panel guards in
 * `ChartComponent` (the `applying` flag + `lastApplied` snap tracking) ever
 * fail to converge for a reason not yet discovered — not just the known
 * data-gap snap case those guards were fixed for — this bounds the damage
 * instead of relying solely on those guards being perfectly correct for
 * every future real-data edge case.
 *
 * The signal it watches is *origin takeovers*: `propose()` calls whose
 * `panelId` differs from the panel that currently owns the shared range.
 * This — not raw call volume — is what actually distinguishes a runaway
 * cross-panel bounce (the diagnosis file's cascade "ping-ponging between
 * btc, eth, btc-oi, and dxy") from ordinary use: a real continuous drag
 * fires `propose()` many times per second from the *same* panel (lightweight-
 * charts emits a range-change on every animation frame while panning), which
 * is high call volume but never an origin takeover, since that one panel
 * keeps re-proposing its own progressing range. A user switching gestures
 * from one panel to another is a takeover too, but a human cannot do that
 * more than a couple of times inside `WINDOW_MS`; a bounce does it dozens of
 * times a second. More than `TRIP_THRESHOLD` takeovers within `WINDOW_MS`
 * trips a global cooldown of `COOLDOWN_MS` during which *all* proposals are
 * dropped — short enough that a real multi-panel gesture sequence is barely
 * delayed, long enough to let whatever was bouncing settle.
 *
 * This is a backstop, not the primary fix — the primary fix is
 * `ChartComponent`'s Follow effect deferring its `lastApplied` read-back to
 * a `requestAnimationFrame` so it captures the real settled range instead of
 * a stale synchronous one. Normal cross-panel negotiation in a 4-panel grid
 * (one drive + 3 follows, each of which can itself settle-echo once) alone
 * produces on the order of ~4 origin takeovers, so the threshold has to sit
 * comfortably above that.
 */
const TRIP_THRESHOLD = 8;
const WINDOW_MS = 750;
const COOLDOWN_MS = 750;

@Injectable()
export class ChartSyncService {
  private readonly _range = signal<TimeRange | null>(null);
  private readonly _origin = signal<string | null>(null);

  readonly range = this._range.asReadonly();
  readonly origin = this._origin.asReadonly();

  /** Timestamps of recent origin takeovers, within the current trip-detection window. */
  private takeoverTimestamps: number[] = [];
  /** While `now < cooldownUntil`, every proposal (from any panel) is dropped. */
  private cooldownUntil: number | null = null;

  /** Called by a panel's `ChartComponent` on a visible-time-range change it did not itself apply. */
  propose(panelId: string, range: TimeRange, epsilonSec: number): void {
    const now = this.now();

    if (this.cooldownUntil !== null) {
      if (now < this.cooldownUntil) {
        return; // breaker tripped: still cooling down, suppressing all proposals
      }
      this.cooldownUntil = null;
      this.takeoverTimestamps = [];
    }

    const cur = this._range();
    if (cur && sameRange(cur, range, epsilonSec)) {
      return; // drift guard: not a meaningfully different range, do not re-propose/re-broadcast
    }

    const curOrigin = this._origin();
    if (curOrigin !== null && curOrigin !== panelId) {
      const recent = this.takeoverTimestamps.filter((t) => now - t <= WINDOW_MS);
      recent.push(now);
      if (recent.length > TRIP_THRESHOLD) {
        this.takeoverTimestamps = [];
        this.cooldownUntil = now + COOLDOWN_MS;
        // eslint-disable-next-line no-console
        console.warn(
          `[ChartSyncService] shared range changed origin ${recent.length} times within ${WINDOW_MS}ms ` +
            `(latest: "${panelId}") without settling — suppressing all proposals for ${COOLDOWN_MS}ms ` +
            `(cross-panel sync circuit breaker)`,
        );
        return;
      }
      this.takeoverTimestamps = recent;
    }

    this._origin.set(panelId);
    this._range.set(range);
  }

  /** Called on layout/timeframe rebuild — the new panels start with no shared range. */
  reset(): void {
    this._range.set(null);
    this._origin.set(null);
    this.takeoverTimestamps = [];
    this.cooldownUntil = null;
  }

  private now(): number {
    return Date.now();
  }
}

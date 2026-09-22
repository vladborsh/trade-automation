import type { Timeframe } from '@trade-automation/contracts';
import { TIMEFRAME_MS } from '@trade-automation/contracts';

/**
 * Pure, exported for direct unit testing (no chart/DI needed) — see
 * architecture/panel-sync-and-oi-depth-diagnosis.md bug 3.
 *
 * Converts a `lightweight-charts` logical index (fractional — `getVisibleLogicalRange()`
 * returns e.g. `-3.5`) to a wall-clock second, using this panel's own bar times. Inside the
 * data, linear interpolation between the two neighbouring bars (this is what lets an
 * interpolated instant land INSIDE a real gap, not snap onto a bar). Beyond either end,
 * extrapolation by `tfSec` — this is what makes empty space past the last (or before the
 * first) bar representable at all, which is the whole fix: `lightweight-charts`' own
 * `getVisibleRange()`/`setVisibleRange()` cannot express it (see the diagnosis's "Root cause").
 */
export function logicalToTimeSec(logical: number, timesSec: readonly number[], tfSec: number): number {
  const lastIdx = timesSec.length - 1;
  if (logical <= 0) {
    return timesSec[0] + logical * tfSec;
  }
  if (logical >= lastIdx) {
    return timesSec[lastIdx] + (logical - lastIdx) * tfSec;
  }
  const lo = Math.floor(logical);
  const hi = lo + 1;
  const frac = logical - lo;
  return timesSec[lo] + frac * (timesSec[hi] - timesSec[lo]);
}

/** The inverse of `logicalToTimeSec` — binary search for the bracketing bars, extrapolate by `tfSec` beyond either end. */
export function timeSecToLogical(timeSec: number, timesSec: readonly number[], tfSec: number): number {
  const lastIdx = timesSec.length - 1;
  if (timeSec <= timesSec[0]) {
    return (timeSec - timesSec[0]) / tfSec;
  }
  if (timeSec >= timesSec[lastIdx]) {
    return lastIdx + (timeSec - timesSec[lastIdx]) / tfSec;
  }
  let lo = 0;
  let hi = lastIdx;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timesSec[mid] <= timeSec) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const span = timesSec[hi] - timesSec[lo];
  const frac = span === 0 ? 0 : (timeSec - timesSec[lo]) / span;
  return lo + frac;
}

/**
 * Nearest loaded bar to `timeSec` by wall-clock distance (binary search) — used to place a
 * follower's own horizontal crosshair line (bug 1): each follower reads its OWN value at the
 * driver's hovered instant, never the driver's price (units differ per panel).
 */
export function nearestBarIndexByTime(timeSec: number, timesSec: readonly number[]): number {
  const lastIdx = timesSec.length - 1;
  if (timeSec <= timesSec[0]) {
    return 0;
  }
  if (timeSec >= timesSec[lastIdx]) {
    return lastIdx;
  }
  let lo = 0;
  let hi = lastIdx;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timesSec[mid] <= timeSec) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return timeSec - timesSec[lo] <= timesSec[hi] - timeSec ? lo : hi;
}

/**
 * Pure form of the near-start check, exported for direct unit testing (no chart/DI needed):
 * true once `visibleFromSec` (UTC seconds, lightweight-charts scale) is within
 * `barMultiplier` bars' worth of calendar time — at the given `timeframe` — of `oldestMs`
 * (ms-epoch, wire scale). `oldestMs === null` (nothing loaded yet) is never near.
 */
export function isNearOldestLoaded(
  visibleFromSec: number,
  oldestMs: number | null,
  timeframe: Timeframe,
  barMultiplier: number,
): boolean {
  if (oldestMs === null) {
    return false;
  }
  const thresholdMs = TIMEFRAME_MS[timeframe] * barMultiplier;
  return visibleFromSec * 1000 - oldestMs <= thresholdMs;
}

// How close (in bars' worth of calendar time) the visible range's `from` must get to the
// panel's own oldest loaded bar before `loadOlder()` is requested. A time-based proximity
// check rather than an absolute bar-index one: see the "loadOlder() pagination trigger
// unreachable at real-data buffer depth" follow-up in
// architecture/scroll-back-freeze-diagnosis.md — an index threshold assumes the visible
// viewport can always reach it via zoom or pan, which lightweight-charts' own
// `minBarSpacing` zoom floor breaks once a panel's loaded buffer (HISTORY_LIMIT) exceeds
// roughly panelWidthPx / 0.5 bars, as it now routinely does against real backfilled data.
export const NEAR_START_BAR_MULTIPLIER = 5;

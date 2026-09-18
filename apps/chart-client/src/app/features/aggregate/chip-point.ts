import type { AggregateMetricPoint } from '@trade-automation/contracts';

/**
 * architecture/aggregate-oi.md §1 point 3 — which bar the coverage chip describes: the bar whose
 * bucket `[time, time + tfMs)` contains the crosshair, or the last bar when nothing is hovered.
 * Null when the crosshair is over a time this panel has no bar for (a dropped slot, before the
 * first bar) — the chip then must not describe a neighbouring bar as if it were this one.
 */
export function chipPoint(
  points: readonly AggregateMetricPoint[],
  crosshairMs: number | null,
  tfMs: number,
): AggregateMetricPoint | null {
  if (points.length === 0) {
    return null;
  }
  if (crosshairMs === null) {
    return points[points.length - 1];
  }
  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = points[mid];
    if (crosshairMs < p.time) {
      hi = mid - 1;
    } else if (crosshairMs >= p.time + tfMs) {
      lo = mid + 1;
    } else {
      return p;
    }
  }
  return null;
}

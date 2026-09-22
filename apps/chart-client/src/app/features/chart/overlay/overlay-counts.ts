import type { OverlayPrimitive } from '@trade-automation/contracts';

/** How many overlay primitives of the kinds e2e reads: signal markers and (T-057) rects. */
export interface OverlayCounts {
  marker: number;
  rect: number;
}

/** Counts the chart's overlays by type, for the `data-marker-count` / `data-rect-count` test hooks. */
export function countOverlays(overlays: readonly OverlayPrimitive[]): OverlayCounts {
  const counts: OverlayCounts = { marker: 0, rect: 0 };
  for (const o of overlays) if (o.type === 'marker' || o.type === 'rect') counts[o.type]++;
  return counts;
}

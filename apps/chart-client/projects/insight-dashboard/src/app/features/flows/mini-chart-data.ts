import type { WebFlowsPoint } from '@trade-automation/contracts';
import type { LineData, UTCTimestamp } from 'lightweight-charts';

/**
 * IB-091 — a tile's series as lightweight-charts line data: oldest first and STRICTLY ascending
 * (the library throws on a repeated time; the last value for a time wins), non-finite values out.
 */
export function toLineData(series: readonly WebFlowsPoint[]): LineData<UTCTimestamp>[] {
  const byTime = new Map<number, number>();
  for (const p of series) if (Number.isFinite(p.value)) byTime.set(p.time, p.value);
  return [...byTime].sort(([a], [b]) => a - b).map(([time, value]) => ({ time: time as UTCTimestamp, value }));
}

/** A canvas this browser can draw on (jsdom has none: there the tile shows without its chart). */
export function canDraw(doc: Document): boolean {
  try {
    return doc.createElement('canvas').getContext('2d') !== null;
  } catch {
    return false;
  }
}

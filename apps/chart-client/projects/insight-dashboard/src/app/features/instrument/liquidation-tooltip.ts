import { formatUsd } from '../liquidations/liquidations.format';
import type { LiquidationMarker } from './liquidation-markers.adapter';

/**
 * IB-068 — the bubble's hover label: which bubble the cursor is on, and what it says.
 *
 * Pure, with its own spec (AGENTS.md); `liquidation-markers.primitive.ts` only paints the result.
 * The label is where the numbers the bubble cannot show live: its size is clamped at the top of
 * the scale and a bubble is one circle however many fills it stands for, so the tooltip says the
 * real sum, how many liquidations, and the largest of them.
 */

export interface PlacedMarker { x: number; y: number; m: LiquidationMarker }

/** Pixels outside the drawn circle that still count as on it: a 3 px bubble is hard to hit. */
export const HIT_SLACK_PX = 3;

/**
 * The bubble under (x, y), in the chart's CSS pixels, or null. Where bubbles overlap, the one whose
 * centre is nearest wins: it is the one the reader is aiming at.
 */
export function markerUnder(points: readonly PlacedMarker[], x: number, y: number): PlacedMarker | null {
  let best: PlacedMarker | null = null;
  let bestDistance = Infinity;
  for (const p of points) {
    const distance = Math.hypot(p.x - x, p.y - y);
    if (distance <= p.m.radius + HIT_SLACK_PX && distance < bestDistance) {
      best = p;
      bestDistance = distance;
    }
  }
  return best;
}

/** The label's lines, top to bottom. English, like the rest of the app's UI. */
export function tooltipLines(m: LiquidationMarker): string[] {
  const who = m.side === 'long' ? 'mostly longs' : 'mostly shorts';
  const count = m.events === 1 ? '1 liquidation' : `${m.events.toLocaleString('en-US')} liquidations`;
  return [
    `${formatUsd(m.usd)} liquidated · ${who}`,
    m.events === 1 ? count : `${count} · largest ${formatUsd(m.largestUsd)}`,
    m.venues.join(', '),
  ];
}

/**
 * Pixels kept clear at the pane's right edge: the price lines' tags (PDH, PWL, the last price) are
 * drawn there over the series, and would cover the label's end.
 */
export const RIGHT_RESERVE_PX = 110;

/**
 * Where the label's left edge goes, in CSS pixels: right of the bubble, or left of it when that
 * would run into the right edge's tags; never off the left edge.
 */
export function labelLeft(anchorX: number, gap: number, width: number, paneWidth: number): number {
  const right = anchorX + gap;
  if (right + width <= paneWidth - RIGHT_RESERVE_PX) return right;
  return Math.max(0, anchorX - gap - width);
}

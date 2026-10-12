import type { WebLiquidationEvent } from '@trade-automation/contracts';

/**
 * IB-039 — liquidation events → bubbles on the price chart (design §12.5).
 *
 * Pure, with its own spec (AGENTS.md). Three rules here decide whether a reader sees what
 * happened or an impression of it:
 *
 * 1. **Several events in one bar become ONE bubble**, summed. A cascade is hundreds of fills in
 *    a minute; drawn individually at 1m they overlap into a smear that looks like one medium
 *    event, which is the opposite of what a cascade is.
 * 2. **Radius is a square-root of USD, clamped 3–14 px.** Area, not radius, is what the eye
 *    reads as quantity, so radius ∝ √usd keeps a 4× liquidation looking 4× bigger rather than
 *    16×. Below 3 px a bubble is invisible; above 14 px it covers the candles it is about.
 * 3. **A clamped bubble is marked**, because the clamp destroys information: at the top of the
 *    scale a $2M and a $40M event draw identically, and the chart must not imply they are alike.
 */

/** Bars narrower than this are drawn as one bubble; set by the chart's timeframe. */
export interface MarkerOptions {
  /** The chart's bar length in seconds — events are bucketed to it. */
  barSeconds: number;
  /** Largest USD that still scales; above it every bubble is the maximum radius. */
  scaleCeilingUsd?: number;
}

export interface LiquidationMarker {
  /** Bar start, epoch seconds — where the bubble sits on the time scale. */
  time: number;
  /** Volume-weighted price of the events in the bar, so the bubble sits where the money was. */
  price: number;
  /** Summed USD of every event in the bar. */
  usd: number;
  /** The side holding more USD in this bar. Ties go to longs, which is the down case. */
  side: 'long' | 'short';
  /** How many events this bubble stands for; 1 unless it is a bucket. */
  events: number;
  radius: number;
  /** True when `usd` exceeded the scale ceiling, so the radius understates it. */
  clamped: boolean;
  venues: string[];
}

export const MIN_RADIUS_PX = 3;
export const MAX_RADIUS_PX = 14;
/** $10M fills the scale: above that the bubble stops growing and says so. */
export const DEFAULT_SCALE_CEILING_USD = 10_000_000;

export function floorToBar(timeSec: number, barSeconds: number): number {
  return Math.floor(timeSec / barSeconds) * barSeconds;
}

/**
 * Radius in pixels for a bucket's USD.
 *
 * `sqrt` so the AREA tracks the money. A linear radius makes a 100× event look 10 000× bigger
 * and turns an ordinary hour into a catastrophe.
 */
export function radiusFor(usd: number, ceiling = DEFAULT_SCALE_CEILING_USD): { radius: number; clamped: boolean } {
  if (usd <= 0) return { radius: MIN_RADIUS_PX, clamped: false };
  const scaled = Math.sqrt(Math.min(usd, ceiling) / ceiling);
  const radius = MIN_RADIUS_PX + scaled * (MAX_RADIUS_PX - MIN_RADIUS_PX);
  return { radius: Math.round(radius * 10) / 10, clamped: usd > ceiling };
}

/**
 * Events → one marker per occupied bar, in time order.
 *
 * The price is **volume weighted** rather than the last event's: a bar holding a $10 000 fill at
 * 100 and a $1M fill at 95 happened at 95 for every purpose a reader cares about, and taking the
 * last event would put the bubble wherever the tape happened to end.
 */
export function toLiquidationMarkers(
  events: readonly WebLiquidationEvent[],
  options: MarkerOptions,
): LiquidationMarker[] {
  const ceiling = options.scaleCeilingUsd ?? DEFAULT_SCALE_CEILING_USD;
  const buckets = new Map<number, {
    long: number; short: number; notional: number; weighted: number; events: number; venues: Set<string>;
  }>();

  for (const event of events) {
    const bar = floorToBar(event.time, options.barSeconds);
    const bucket = buckets.get(bar)
      ?? { long: 0, short: 0, notional: 0, weighted: 0, events: 0, venues: new Set<string>() };
    bucket[event.side] += event.usd;
    bucket.notional += event.usd;
    bucket.weighted += event.usd * event.price;
    bucket.events += 1;
    bucket.venues.add(event.venue);
    buckets.set(bar, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, b]) => {
      const { radius, clamped } = radiusFor(b.notional, ceiling);
      return {
        time,
        // a bucket of zero-USD events would divide by zero; fall back to the arithmetic mean
        price: b.notional > 0 ? b.weighted / b.notional : meanPrice(events, time, options.barSeconds),
        usd: b.notional,
        side: b.long >= b.short ? ('long' as const) : ('short' as const),
        events: b.events,
        radius,
        clamped,
        venues: [...b.venues].sort(),
      };
    });
}

function meanPrice(events: readonly WebLiquidationEvent[], bar: number, barSeconds: number): number {
  const inBar = events.filter((e) => floorToBar(e.time, barSeconds) === bar);
  if (inBar.length === 0) return 0;
  return inBar.reduce((sum, e) => sum + e.price, 0) / inBar.length;
}

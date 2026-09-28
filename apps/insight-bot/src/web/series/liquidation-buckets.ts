import type { WebLiquidationBar, WebLiquidationBucket } from '@trade-automation/contracts';

/**
 * IB-031 — bucketing liquidations into the two-colour histogram
 * (architecture/insight-bot-web-dashboard.md §2, §4).
 *
 * Pure, and separate from the SQL, because the rules here are the ones a reader of the chart
 * depends on:
 *
 * - **Long and short are never summed.** The pane's whole point is which side was liquidated
 *   (§3.3 normalises that at the mapper), so a bucket carries both and the renderer draws two
 *   colours. A single "liquidations" number hides the cascade direction, which is the signal.
 * - **Empty buckets are emitted as zeros**, not omitted. A histogram with gaps closed up
 *   compresses quiet hours and makes a cascade look like ordinary activity.
 * - The counts are **visible** liquidations: Binance sends at most one forceOrder event per
 *   second per symbol (§12.2), so this undercounts, and the response says so.
 */

export interface LiquidationRow {
  /** Epoch ms. */
  ts: number;
  /** The side that was LIQUIDATED, already normalised by the collectors' mappers. */
  side: 'long' | 'short';
  notional: number;
}

const BUCKET_MS: Record<WebLiquidationBucket, number> = { '1m': 60_000, '15m': 900_000, '1h': 3_600_000 };

export function bucketMs(bucket: WebLiquidationBucket): number {
  return BUCKET_MS[bucket];
}

export function floorTo(ms: number, size: number): number {
  return Math.floor(ms / size) * size;
}

/**
 * Buckets rows into `[fromMs, toMs)`, emitting every bucket in the range including empty ones.
 * Rows outside the range are ignored rather than clamped into the edge buckets, which would
 * pile a month of history onto the first bar.
 */
export function bucketLiquidations(
  rows: readonly LiquidationRow[],
  bucket: WebLiquidationBucket,
  fromMs: number,
  toMs: number,
): WebLiquidationBar[] {
  const size = bucketMs(bucket);
  const start = floorTo(fromMs, size);
  const bars = new Map<number, WebLiquidationBar>();

  for (let t = start; t < toMs; t += size) {
    bars.set(t, { time: Math.floor(t / 1000), long: 0, short: 0, events: 0 });
  }

  for (const row of rows) {
    if (row.ts < fromMs || row.ts >= toMs) continue;
    const bar = bars.get(floorTo(row.ts, size));
    if (!bar) continue;
    if (row.side === 'long') bar.long += row.notional;
    else bar.short += row.notional;
    bar.events += 1;
  }

  return [...bars.values()].sort((a, b) => a.time - b.time);
}

/** The `n` largest single liquidations in the window, biggest first. */
export function topLiquidations<T extends { notional: number }>(rows: readonly T[], n: number): T[] {
  return [...rows].sort((a, b) => b.notional - a.notional).slice(0, Math.max(0, n));
}

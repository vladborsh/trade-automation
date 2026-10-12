import type { WebLiquidationWindowStats, WebLiquidationWindow } from '@trade-automation/contracts';
import { normBasis, sideStats } from './norm';
import type { BucketRow, TrailingRow } from './pg/overview.repo';

/**
 * IB-038 — turning the four reads into the window statistics the card and the table show.
 *
 * Pure, with its own spec (AGENTS.md), because three of the rules here are the difference
 * between a figure and a claim:
 *
 * 1. **Market-wide sums every row, including rows no coin claims.** The per-coin table is built
 *    through the venue→coin map and an unmapped symbol has no row in it; the headline total must
 *    not lose that money as well, or the page under-reports the market by exactly the amount it
 *    cannot attribute (IB-BUG-011's lesson, applied before it can happen again).
 * 2. **Empty windows are zeros in the median sample**, not absences. Four quiet hours and one
 *    busy one is a median of 0, and that is the honest answer; dropping the quiet ones would
 *    compare a busy window against the average of other busy windows.
 * 3. **Partial windows are excluded from the sample.** The window in progress is incomplete by
 *    definition and would drag the median down; so would a first window the period starts in the
 *    middle of.
 */

/**
 * The boundary-aligned window starts that make up the norm sample: **complete windows only**.
 *
 * Starts at the first boundary at or after `periodStartMs`, ends at the last window that had
 * finished before `nowMs`.
 */
export function completeWindowStarts(periodStartMs: number, nowMs: number, windowSec: number): number[] {
  const w = windowSec * 1000;
  const first = Math.ceil(periodStartMs / w) * w;
  const starts: number[] = [];
  for (let t = first; t + w <= nowMs; t += w) starts.push(t);
  return starts;
}

/** Rows belonging to a scope: one coin, or — for `null` — the whole market, unmapped included. */
function inScope<T extends { symbolId: string | null }>(rows: readonly T[], symbolId: string | null): T[] {
  return symbolId === null ? [...rows] : rows.filter((r) => r.symbolId === symbolId);
}

/**
 * The zero-filled sample for one side (or both, when `side` is null).
 *
 * Buckets outside the grid are dropped rather than appended: they are the partial windows rule 3
 * excludes, and silently letting one in would be a half-length window counted as a whole one.
 */
export function sampleFor(
  buckets: readonly BucketRow[],
  starts: readonly number[],
  side: 'long' | 'short' | null,
): number[] {
  const byBucket = new Map<number, number>();
  for (const row of buckets) {
    if (side !== null && row.side !== side) continue;
    byBucket.set(row.bucketMs, (byBucket.get(row.bucketMs) ?? 0) + row.usd);
  }
  return starts.map((t) => byBucket.get(t) ?? 0);
}

export interface WindowStatsInput {
  window: WebLiquidationWindow;
  windowSec: number;
  nowMs: number;
  periodStartMs: number;
  /** Already restricted to this window size, over the norm period. */
  buckets: readonly BucketRow[];
  trailing: readonly TrailingRow[];
  /** `null` for market-wide, which includes rows the venue→coin map does not claim. */
  symbolId: string | null;
  venues: readonly string[];
}

export function windowStats(input: WindowStatsInput): WebLiquidationWindowStats {
  const { windowSec, nowMs, periodStartMs, symbolId } = input;
  const buckets = inScope(input.buckets, symbolId);
  const trailing = inScope(input.trailing, symbolId);

  const starts = completeWindowStarts(periodStartMs, nowMs, windowSec);
  const periodDays = starts.length === 0 ? 0 : (starts.length * windowSec) / 86_400;

  const usd = (side: 'long' | 'short' | null): number => trailing
    .filter((r) => side === null || r.side === side)
    .reduce((sum, r) => sum + (r.usdByWindow[windowSec] ?? 0), 0);

  const long = sideStats({ trailing: usd('long'), alignedSums: sampleFor(buckets, starts, 'long'), periodDays });
  const short = sideStats({ trailing: usd('short'), alignedSums: sampleFor(buckets, starts, 'short'), periodDays });
  const total = sideStats({ trailing: usd(null), alignedSums: sampleFor(buckets, starts, null), periodDays });

  return {
    window: input.window,
    events: trailing.reduce((sum, r) => sum + (r.eventsByWindow[windowSec] ?? 0), 0),
    long,
    short,
    total,
    basis: normBasis({
      periodDays,
      alignedSums: sampleFor(buckets, starts, null),
      venues: input.venues,
      sides: [long, short, total],
    }),
  };
}

/*
 * Display rules — the long/short leaning sentence and §12.1's escalation steps — deliberately
 * live ONLY on the client (`liquidations.format.ts`). They were written here first and were never
 * called: a second copy of a threshold rule that nothing exercises is a rule that drifts, and the
 * server has no business deciding what colour a card is.
 */

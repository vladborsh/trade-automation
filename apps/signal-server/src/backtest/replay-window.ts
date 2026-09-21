import { Candle, CompactCandleTuple, TIMEFRAME_MS, Timeframe } from '@trade-automation/contracts';

/**
 * architecture/backtest-app-system-design.md §5.1, §5.3, §7.2 — the pure arithmetic behind the
 * replay candle endpoints. No I/O: the services feed in store coverage and bars.
 */

const ONE_MINUTE_MS = TIMEFRAME_MS['1m'];

/**
 * End (exclusive) of the closed `tf` bars visible at `before`: a bar is closed when
 * `openTime + tfMs <= before`, so every closed bar opens before `floor(before / tfMs) * tfMs`.
 */
export function closedBarsEnd(before: number, tf: Timeframe): number {
  const tfMs = TIMEFRAME_MS[tf];
  return Math.floor(before / tfMs) * tfMs;
}

/**
 * The bucket the forming bar at `before` covers, `[floor(before/tfMs)*tfMs, before)`, or null
 * when `before` is on a `tf` boundary (the bar that closes there is complete) and always for 1m
 * (a revealed 1m candle is closed by definition, §5.1).
 */
export function formingRange(before: number, tf: Timeframe): { from: number; to: number } | null {
  if (tf === '1m') return null;
  const from = closedBarsEnd(before, tf);
  return from === before ? null : { from, to: before };
}

export interface Range {
  from: number;
  /** Exclusive. */
  to: number;
}

/**
 * The holes in `window` the persisted `tf` bars leave: before the first bar, between two bars
 * more than `tfMs` apart, and after the last bar; the whole window when it holds none. Each hole
 * is a candidate for folding from 1m. Whether it is a real gap in the tape (a weekend, a market
 * close) or bars the derive job has not written yet is decided by whether 1m exists there,
 * which is the caller's I/O. `persistedOpenTimes` must be ascending and inside the window.
 * Holes are `tf`-aligned when the window is.
 */
export function holesToFold(window: Range, persistedOpenTimes: readonly number[], tf: Timeframe): Range[] {
  if (window.from >= window.to) return [];
  const tfMs = TIMEFRAME_MS[tf];
  const holes: Range[] = [];
  let expected = window.from; // open of the next bar we would expect to see
  for (const openTime of persistedOpenTimes) {
    if (openTime > expected) holes.push({ from: expected, to: openTime });
    expected = Math.max(expected, openTime + tfMs);
  }
  if (expected < window.to) holes.push({ from: expected, to: window.to });
  return holes;
}

/**
 * Merges persisted and folded bars for one window: ascending, one bar per `openTime`, a persisted
 * bar winning over a folded one (it is the store's truth, venue or resampled alike).
 */
export function mergeBars(persisted: readonly Candle[], folded: readonly Candle[]): Candle[] {
  const byOpen = new Map<number, Candle>();
  for (const c of folded) byOpen.set(c.openTime, c);
  for (const c of persisted) byOpen.set(c.openTime, c);
  return [...byOpen.values()].sort((a, b) => a.openTime - b.openTime);
}

/**
 * §5.3 — the ahead page's exclusive upper bound on 1m `openTime`. A 1m candle belongs to the
 * period only if it closes by `periodToMs` (`openTime + 60_000 <= periodToMs`); the cursor can
 * never pass `periodToMs`, so a later candle can never be revealed.
 */
export function aheadEnd(periodToMs: number): number {
  return periodToMs - ONE_MINUTE_MS + 1;
}

/** §5.3 compact form: `[openTime, open, high, low, close, volume]`. */
export function toCompactTuple(c: Candle): CompactCandleTuple {
  return [c.openTime, c.open, c.high, c.low, c.close, c.volume];
}

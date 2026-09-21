import { Candle, CompactCandleTuple, Coverage, TIMEFRAME_MS, Timeframe } from '@trade-automation/contracts';

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
 * The parts of `window` the persisted `tf` does not cover, which must be folded from 1m. "Not
 * covered" means before the first or after the last persisted bar. A hole *inside* the persisted
 * span is a real gap in the tape (the derive job fills every hole it has 1m for, T-012), so it is
 * not folded. The persisted span is `[coverage.from, coverage.to + tfMs)`. With no persisted
 * coverage at all, the whole window is folded. Returned ranges are `tf`-aligned when the window is.
 */
export function rangesToFold(window: Range, persisted: Coverage | null, tf: Timeframe): Range[] {
  if (window.from >= window.to) return [];
  if (!persisted) return [window];
  const persistedTo = persisted.to + TIMEFRAME_MS[tf];
  const out: Range[] = [];
  if (window.from < persisted.from) out.push({ from: window.from, to: Math.min(window.to, persisted.from) });
  if (window.to > persistedTo) out.push({ from: Math.max(window.from, persistedTo), to: window.to });
  return out;
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

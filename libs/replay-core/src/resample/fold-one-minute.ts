import { Candle, TIMEFRAME_MS, Timeframe } from '@trade-automation/contracts';
import { Resampler } from './resampler';

const ONE_MINUTE_MS = TIMEFRAME_MS['1m'];

/**
 * architecture/backtest-app-system-design.md §2.1, §5.1 — a stateless helper on top of the
 * `Resampler`: fold a run of closed 1m candles into `tf`, revealed up to (and including) every
 * 1m candle whose `openTime + 60_000 <= upToMs`.
 *
 * Returns the closed `tf` bars this run completes, plus the still-forming `tf` bar built from the
 * 1m candles between its open and `upToMs` — or `null` when `upToMs` lands exactly on a `tf`
 * boundary (the bar that closes there is already the last element of `closed`), or when no 1m
 * has arrived yet in the bucket containing `upToMs`. Every bucket that ends by `upToMs` is in
 * `closed`, including the last one before a gap in the 1m run.
 *
 * `bars1m` need not be pre-filtered to `upToMs`; candles whose 1m interval is not yet fully
 * revealed at `upToMs` are ignored, so the caller may pass a superset (e.g. an ahead-cache page).
 */
export function foldOneMinute(
  bars1m: readonly Candle[],
  tf: Timeframe,
  upToMs: number,
): { closed: Candle[]; forming: Candle | null } {
  const tfMs = TIMEFRAME_MS[tf];

  if (tf === '1m') {
    const closed = bars1m.filter((c) => c.openTime + ONE_MINUTE_MS <= upToMs);
    return { closed, forming: null };
  }

  const onBoundary = upToMs % tfMs === 0;
  // the bucket the cursor sits in: on a boundary that is the bucket that just closed, otherwise
  // the bucket currently forming.
  const cursorBucketStart = onBoundary ? upToMs - tfMs : Math.floor(upToMs / tfMs) * tfMs;

  const resampler = new Resampler();
  const closed: Candle[] = [];
  let forming: Candle | null = null;

  for (const bar of bars1m) {
    if (bar.openTime + ONE_MINUTE_MS > upToMs) continue; // 1m interval not yet fully revealed

    const result = resampler.onClosed1m(bar);
    for (const c of result.closed) {
      if (c.timeframe === tf) closed.push(c);
    }
    forming = result.forming.find((c) => c.timeframe === tf) ?? forming;
  }

  if (forming && forming.openTime !== cursorBucketStart) {
    // the last fed 1m candle belongs to an earlier bucket (an empty stretch precedes upToMs) —
    // nothing has arrived for the bucket containing the cursor yet. That earlier bucket ended
    // before the cursor's, so it is complete: close it (BUG-001 — it used to be dropped, losing
    // the last bar before every weekend, market close or other gap).
    closed.push({ ...forming, closed: true });
    forming = null;
  } else if (forming && onBoundary) {
    // upToMs is exactly the close of the bucket the loop above left forming (nothing arrived from
    // the next bucket to flush it through Resampler.onClosed1m) — it is complete, not forming.
    closed.push({ ...forming, closed: true });
    forming = null;
  }

  return { closed, forming };
}

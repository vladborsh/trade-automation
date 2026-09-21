import { TIMEFRAME_MS, type Candle, type Timeframe } from '@trade-automation/contracts';
import { foldOneMinute } from '@trade-automation/replay-core';

/** One panel's bars of its timeframe at the cursor: closed bars, ascending, plus the forming one. */
export interface TfSeries {
  readonly closed: readonly Candle[];
  readonly forming: Candle | null;
}

/** Open of the bar containing `cursorMs` — where the carry for the forming bar starts. */
export function bucketStart(cursorMs: number, tf: Timeframe): number {
  const tfMs = TIMEFRAME_MS[tf];
  return Math.floor(cursorMs / tfMs) * tfMs;
}

/**
 * backtest-app-system-design.md §5.4 step 2, for one panel. `revealed1m` is every 1m candle from
 * the open of the bar that was forming at the previous cursor (`bucketStart(prev, tf)`) up to and
 * including those revealed at `upToMs`. Folding that whole run with replay-core's `foldOneMinute`
 * — the function the server's history endpoint uses — rebuilds the forming bar bit for bit, rather
 * than patching the old one with the new minutes. Its closed bars replace the previous forming bar
 * (same `openTime`) and append after the existing closed bars; its forming bar replaces the old one.
 */
export function foldStep(series: TfSeries, revealed1m: readonly Candle[], tf: Timeframe, upToMs: number): TfSeries {
  const { closed, forming } = foldOneMinute(revealed1m, tf, upToMs);
  if (closed.length === 0) return { closed: series.closed, forming };
  const cut = closed[0].openTime;
  let keep = series.closed.length;
  while (keep > 0 && series.closed[keep - 1].openTime >= cut) keep--;
  return { closed: [...series.closed.slice(0, keep), ...closed], forming };
}

/** What the chart draws: the closed bars, then the forming one. */
export function seriesBars(series: TfSeries): Candle[] {
  return series.forming ? [...series.closed, series.forming] : [...series.closed];
}

/**
 * A panel's series at `cursorMs` from two halves that meet at `anchor`, a bar boundary: the
 * server's closed bars before `anchor` (`GET …/candles?before=anchor`, which the server serves
 * even while the client's cursor is ahead of the session's stored one) and the 1m candles from
 * `anchor` on, folded with `foldOneMinute` — the same fold the server would run for
 * `before = cursorMs`, so the result is identical.
 */
export function seriesAt(closedBeforeAnchor: readonly Candle[], revealed1mFromAnchor: readonly Candle[], tf: Timeframe, cursorMs: number): TfSeries {
  const { closed, forming } = foldOneMinute(revealed1mFromAnchor, tf, cursorMs);
  return { closed: [...closedBeforeAnchor, ...closed], forming };
}

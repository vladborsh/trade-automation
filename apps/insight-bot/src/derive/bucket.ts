import type { AggTimeframe, Candle1mRow, CandleAggRow } from '../collectors/writers/tables';

/**
 * IB-014 — the pure fold of 1m rows into a coarser bucket (design §8.1, D4: only 1m is ingested;
 * 15m/1h/4h/1d are derived by an idempotent job).
 *
 * No clock and no I/O: the caller says which bucket it wants and hands over the rows. That is what
 * lets the same function serve the on-close job and the history command, and what makes the
 * comparison against the venue's own coarse klines a unit test rather than an argument.
 */

export const MINUTE_MS = 60_000;

/** Minutes in one bucket of each derived timeframe. */
export const TF_MINUTES: Record<AggTimeframe, number> = {
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
};

export const AGG_TIMEFRAMES = Object.keys(TF_MINUTES) as AggTimeframe[];

/**
 * The start of the bucket containing `ms`.
 *
 * Every derived timeframe divides a UTC day evenly and the epoch is itself a UTC midnight, so
 * flooring against the epoch is the same as flooring against midnight — 4h buckets land on
 * 00/04/08/12/16/20 UTC, which is exactly where Binance puts its own 4h klines. (A timeframe that
 * did *not* divide a day, say 6h on a 5-day week, would need a calendar anchor instead; none of
 * ours do, and the spec pins the boundaries.)
 */
export function bucketStart(tf: AggTimeframe, ms: number): number {
  const span = TF_MINUTES[tf] * MINUTE_MS;
  return Math.floor(ms / span) * span;
}

/** The bucket that closed at `now`, or null when `now` is not on a boundary of `tf`. */
export function justClosedBucket(tf: AggTimeframe, now: number): number | null {
  const span = TF_MINUTES[tf] * MINUTE_MS;
  const start = bucketStart(tf, now);
  // `now` is a boundary when flooring the minute lands exactly on it: the bar that closed is the
  // one before. Called from a clock that ticks per minute, so minute resolution is enough.
  const onBoundary = Math.floor(now / MINUTE_MS) * MINUTE_MS === start;
  return onBoundary ? start - span : null;
}

/**
 * Compensated (Neumaier) summation, and the reason is measured, not theoretical.
 *
 * The venue's own coarse bar carries the EXACT decimal sum of its 1m volumes — verified against a
 * stored month of BTCUSDT perp, where Postgres' `sum(numeric)` equals Binance's 4h `volume` string
 * on all 186 buckets. Summing the same values as float64 in stream order does not reproduce it: a
 * naive `reduce` matched the venue on only 30 of 186 buckets (20 of 186 for quote volume), while
 * this compensated sum matches on 182 and 179. The remaining few differ by ~1e-15 relative because
 * the exact decimal sum has no exact double at all, so no float algorithm can close them — only
 * carrying these fields as decimals end to end would, which would change the shared `Candle1mRow`.
 *
 * OHLC and `trades` need none of this: they are picked or compared, never accumulated, and match
 * the venue bit-for-bit.
 */
function compensatedSum(values: readonly number[]): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const t = sum + value;
    // the larger magnitude keeps its low bits; the smaller one's are what would be lost
    compensation += Math.abs(sum) >= Math.abs(value) ? sum - t + value : value - t + sum;
    sum = t;
  }
  return sum + compensation;
}

function sum(values: Array<number | null | undefined>): number | null {
  // Absent stays absent (IB-002's rule): a bucket whose rows never reported taker volume must not
  // claim 0, which would read as "no taker buys happened".
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  return present.length === 0 ? null : compensatedSum(present);
}

export { compensatedSum };

/**
 * Folds `rows` — 1m bars of one (venue, market, symbol), in any order — into the bucket starting at
 * `bucketStartMs`. Rows outside the bucket are ignored rather than trusted, so a caller that
 * over-fetches cannot silently widen a bar.
 *
 * `complete` means every minute the timeframe expects was present. An incomplete bucket is still
 * returned and still written: the chart should show the bar that exists, and `bars`/`complete` are
 * what tell a reader (and IB-031's charts) not to trust it as the venue's own. This is the
 * distinction signal-server's warm-up mismatch warnings turned out to be about — a partial hour
 * compared against a complete native bar is not a disagreement, it is an incomplete bucket.
 */
export function foldBucket(
  rows: readonly Candle1mRow[],
  tf: AggTimeframe,
  bucketStartMs: number,
): CandleAggRow | null {
  const span = TF_MINUTES[tf] * MINUTE_MS;
  const inBucket = rows
    .filter((r) => {
      const t = r.openTime.getTime();
      return t >= bucketStartMs && t < bucketStartMs + span;
    })
    .sort((a, b) => a.openTime.getTime() - b.openTime.getTime());

  if (inBucket.length === 0) return null;

  const first = inBucket[0];
  const last = inBucket[inBucket.length - 1];

  return {
    venue: first.venue,
    market: first.market,
    symbol: first.symbol,
    tf,
    openTime: new Date(bucketStartMs),
    // OHLC by time, not by position in the input: open is the earliest minute's open and close the
    // latest minute's close, which is why the rows are sorted above rather than assumed ordered.
    open: first.open,
    high: Math.max(...inBucket.map((r) => r.high)),
    low: Math.min(...inBucket.map((r) => r.low)),
    close: last.close,
    volume: compensatedSum(inBucket.map((r) => r.volume)),
    quoteVolume: sum(inBucket.map((r) => r.quoteVolume)),
    trades: sum(inBucket.map((r) => r.trades)),
    takerBuyVolume: sum(inBucket.map((r) => r.takerBuyVolume)),
    takerBuyQuoteVolume: sum(inBucket.map((r) => r.takerBuyQuoteVolume)),
    bars: inBucket.length,
    complete: inBucket.length === TF_MINUTES[tf],
  };
}

/**
 * Every bucket of `tf` the rows touch, folded. Used by the history command: one pass over a month
 * of 1m rows produces every coarse bar of that month, including the partial ones at its edges.
 */
export function foldAll(rows: readonly Candle1mRow[], tf: AggTimeframe): CandleAggRow[] {
  const byBucket = new Map<number, Candle1mRow[]>();
  for (const row of rows) {
    const start = bucketStart(tf, row.openTime.getTime());
    const bucket = byBucket.get(start) ?? [];
    bucket.push(row);
    byBucket.set(start, bucket);
  }
  return [...byBucket.keys()]
    .sort((a, b) => a - b)
    .map((start) => foldBucket(byBucket.get(start) ?? [], tf, start))
    .filter((bar): bar is CandleAggRow => bar !== null);
}

import {
  WEB_MAX_1M_RANGE_DAYS, WEB_MAX_CANDLE_BARS, WEB_MAX_POINTS, type WebLiquidationBucket, type WebTimeframe,
} from '@trade-automation/contracts';

/**
 * The instrument page's timeframe choice and what follows from it
 * (architecture/insight-bot-web-dashboard.md §13).
 *
 * 2026-10-24: **no range buttons.** The window follows the timeframe: a frame gets as much history
 * as reads well at its bar width, and scrolling left loads more (`pane-merge.ts`). That retires the
 * range × timeframe matrix and with it the case the old module existed for. The spec pins that every
 * frame's window is one the server serves, so a wider window fails the build rather than the page.
 *
 * IB-065: since IB-063 the candles come from Binance and reach back to a coin's listing, so a
 * window may now be wider than the side reads allow — 1W opens on two years. See `sideWindow`.
 */

export const TIMEFRAMES: readonly WebTimeframe[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d', '1w'];

/**
 * The button's text. The id is Binance's `interval` (lower case, `1w`); the trading convention
 * writes a week as 1W, which is what a reader looks for. An identifier, so not translated.
 */
export function timeframeLabel(tf: WebTimeframe): string {
  return tf === '1w' ? '1W' : tf;
}

/**
 * Days of history a timeframe opens with: roughly 1 000–2 200 bars, a screen's worth, at the
 * intraday frames. 1d is held to `WEB_MAX_1M_RANGE_DAYS` (2026-10-29: a 365-day 1d window failed
 * the whole page with `RANGE_TOO_WIDE`; that was before side reads were clamped, and is left as
 * it was). 1w opens on 104 weeks (IB-065: "100 or more").
 */
export const WINDOW_DAYS: Readonly<Record<WebTimeframe, number>> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 7,
  '1h': 30,
  '4h': 90,
  '1d': 90,
  '1w': 728,
};

const DAY_MS = 86_400_000;

/** The window a timeframe opens with, ending at `toMs`; also the width of each earlier window. */
export function windowFor(tf: WebTimeframe, toMs: number): { fromMs: number; toMs: number } {
  return { fromMs: toMs - WINDOW_DAYS[tf] * DAY_MS, toMs };
}

/**
 * IB-065 — the range of every read that is not candles: open interest, funding, long/short,
 * liquidations and their events, the top-50 table and the calendar. They come from the local tape,
 * and funding, the liquidation events, the top table and the calendar are refused beyond
 * `WEB_MAX_1M_RANGE_DAYS`. So a window wider than that (only 1w today) reads them over its LAST
 * 90 days.
 *
 * **Clamped rather than hidden**, deliberately: the tape starts on 2026-09-28, so on a two-year
 * weekly chart these panes have at most a few weeks of data no matter what range is asked for.
 * Clamping keeps exactly that data on screen; hiding the panes would throw it away to avoid a
 * blank stretch that is there anyway. Older 1w windows (scrolling left) read their own last
 * 90 days, which is before the tape and answers empty, as the panes already do before 09-28.
 */
export function sideWindow(fromMs: number, toMs: number): { fromMs: number; toMs: number } {
  return { fromMs: Math.max(fromMs, toMs - WEB_MAX_1M_RANGE_DAYS * DAY_MS), toMs };
}

/** Bar width per timeframe, for the bucket and window arithmetic below. */
const TF_MINUTES: Readonly<Record<WebTimeframe, number>> = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1_440, '1w': 10_080,
};
const BUCKET_MINUTES: Readonly<Record<WebLiquidationBucket, number>> = { '1m': 1, '15m': 15, '1h': 60 };

/**
 * The liquidation bucket for a timeframe: the bar width where the server has one, else the finest
 * bucket that does not get thinned. `WebLiquidationBucketSchema` is 1m | 15m | 1h. A bubble is
 * bucketed to the bar on screen anyway (`liquidation-markers.adapter.ts`); this is the histogram
 * behind the summary.
 *
 * IB-065, **3m → 1m and 5m → 15m.** Neither has a bucket of its own width. Finer is better, but
 * the server thins a series over `WEB_MAX_POINTS` (5 000) by keeping every n-th point, and a thinned
 * histogram drops liquidations, it does not merge them. A 3m window (3 days) is 4 320 one-minute
 * buckets and stays whole. A 5m window (5 days) would be 7 200 and be thinned, so 5m takes 15m
 * (480 buckets), where three bars share a bucket.
 */
export function bucketFor(tf: WebTimeframe): WebLiquidationBucket {
  if (tf === '1m' || tf === '3m') return '1m';
  if (tf === '5m' || tf === '15m') return '15m';
  return '1h';
}

/**
 * True when every read of the timeframe's window is one the server serves; every offered frame
 * must be. Three caps, one per kind of read:
 * - the candles span at most `WEB_MAX_CANDLE_BARS` bars, and so do the 1d candles behind the
 *   day/week levels (the window plus `levelsLookbackDays`);
 * - the side reads (`sideWindow`) span at most `WEB_MAX_1M_RANGE_DAYS`;
 * - the liquidation histogram fits `WEB_MAX_POINTS`, so it is not thinned.
 */
export function isServed(tf: WebTimeframe, levelsLookbackDays = 14): boolean {
  const { fromMs, toMs } = windowFor(tf, 0);
  const days = (toMs - fromMs) / DAY_MS;
  const side = sideWindow(fromMs, toMs);
  const sideMinutes = (side.toMs - side.fromMs) / 60_000;
  return (days * 1_440) / TF_MINUTES[tf] <= WEB_MAX_CANDLE_BARS
    && days + levelsLookbackDays <= WEB_MAX_CANDLE_BARS
    && side.toMs - side.fromMs <= WEB_MAX_1M_RANGE_DAYS * DAY_MS
    && sideMinutes / BUCKET_MINUTES[bucketFor(tf)] <= WEB_MAX_POINTS;
}

import { WEB_MAX_1M_RANGE_DAYS, type WebLiquidationBucket, type WebTimeframe } from '@trade-automation/contracts';

/**
 * The instrument page's timeframe choice and what follows from it
 * (architecture/insight-bot-web-dashboard.md §13).
 *
 * 2026-10-24: **no range buttons.** The window follows the timeframe: a frame gets as much history
 * as reads well at its bar width, and scrolling left loads more (`pane-merge.ts`). That retires the
 * range × timeframe matrix and with it the case the old module existed for: no frame's window is
 * wider than the server serves (1m over `WEB_MAX_1M_RANGE_DAYS` is refused), so there is nothing to
 * coarsen and no pair to disable. The spec pins that, so a wider 1m window fails the build rather
 * than the page.
 */

export const TIMEFRAMES: readonly WebTimeframe[] = ['1m', '15m', '1h', '4h', '1d'];

/** Days of history a timeframe opens with: roughly 1 000–2 200 bars, a screen's worth at any frame. */
export const WINDOW_DAYS: Readonly<Record<WebTimeframe, number>> = {
  '1m': 1,
  '15m': 7,
  '1h': 30,
  '4h': 90,
  '1d': 365,
};

const DAY_MS = 86_400_000;

/** The window a timeframe opens with, ending at `toMs`; also the width of each earlier window. */
export function windowFor(tf: WebTimeframe, toMs: number): { fromMs: number; toMs: number } {
  return { fromMs: toMs - WINDOW_DAYS[tf] * DAY_MS, toMs };
}

/**
 * The liquidation bucket for a timeframe: the bar width where the server has one, else its
 * coarsest (`WebLiquidationBucketSchema` is 1m | 15m | 1h). A bubble is bucketed to the bar on
 * screen anyway (`liquidation-markers.adapter.ts`); this is the histogram behind the summary.
 */
export function bucketFor(tf: WebTimeframe): WebLiquidationBucket {
  if (tf === '1m') return '1m';
  if (tf === '15m') return '15m';
  return '1h';
}

/** True when the timeframe's window is one the server serves; every offered frame must be. */
export function isServed(tf: WebTimeframe): boolean {
  return tf !== '1m' || WINDOW_DAYS[tf] <= WEB_MAX_1M_RANGE_DAYS;
}

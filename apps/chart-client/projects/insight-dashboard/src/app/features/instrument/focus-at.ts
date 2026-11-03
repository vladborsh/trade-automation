import type { WebTimeframe } from '@trade-automation/contracts';
import { windowFor } from './time-range';

/**
 * IB-098 — the instrument page opened from an insight or a large liquidation: `?at=<unix sec>`
 * (IB-088's link format, the only one). The chart opens with that moment in view and marked.
 *
 * The data window is NOT moved to the moment: it is the timeframe's ordinary window, which ends
 * now, so the live tail and the left-edge history reads keep working exactly as they do on any
 * other visit. Instead the finest timeframe whose window already holds the moment (with room for
 * the bars around it) is chosen, and only the VIEW is placed on the moment.
 */

/** Bars shown around the moment: enough to see what led to it and what followed. */
export const FOCUS_BARS = 120;
/** The oldest moment a link may carry: the widest intraday window (4h opens on 90 days). */
export const FOCUS_MAX_AGE_DAYS = 90;
/** Clock skew between the server that made the link and this browser. */
const FUTURE_SLACK_SEC = 60;

/** The frames a moment may open on, finest first. 1d/1w would bury a minute-scale event. */
export const FOCUS_TIMEFRAMES: readonly WebTimeframe[] = ['1m', '3m', '5m', '15m', '1h', '4h'];

const TF_SEC: Readonly<Record<string, number>> = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400 };

/**
 * `?at=` as a moment, or null when it is not one we can show: not an integer, in the future,
 * or older than FOCUS_MAX_AGE_DAYS. Null means the page opens as it always does — a bad link
 * costs the reader nothing.
 */
export function parseAt(raw: string | null | undefined, nowMs: number): number | null {
  if (raw === null || raw === undefined || !/^\d{1,12}$/.test(raw.trim())) return null;
  const at = Number(raw.trim());
  const nowSec = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(at) || at > nowSec + FUTURE_SLACK_SEC) return null;
  if (at < nowSec - FOCUS_MAX_AGE_DAYS * 86_400) return null;
  return at;
}

export interface FocusView {
  /** The moment, as the link gave it. */
  atSec: number;
  timeframe: WebTimeframe;
  /** The bar the moment falls in (the marker's position). */
  barSec: number;
  /** The visible range, in seconds: FOCUS_BARS around the bar, kept inside the data window. */
  from: number;
  to: number;
}

/** The view for a moment: the finest frame that holds it, and the range around it. */
export function focusView(atSec: number, nowMs: number): FocusView {
  const nowSec = Math.floor(nowMs / 1000);
  const half = FOCUS_BARS / 2;
  const timeframe = FOCUS_TIMEFRAMES.find((tf) => {
    const fromSec = windowFor(tf, nowMs).fromMs / 1000;
    return atSec - half * TF_SEC[tf] >= fromSec;
  }) ?? '4h';
  const step = TF_SEC[timeframe];
  const barSec = Math.floor(atSec / step) * step;
  const windowFrom = Math.ceil(windowFor(timeframe, nowMs).fromMs / 1000);
  // centred, then slid inside [window start, now] — a moment two minutes ago cannot be centred
  let from = barSec - half * step;
  let to = barSec + half * step;
  if (to > nowSec) { from -= to - nowSec; to = nowSec; }
  if (from < windowFrom) { to += windowFrom - from; from = windowFrom; }
  return { atSec, timeframe, barSec, from, to: Math.min(to, nowSec) };
}

/**
 * The drawn bar nearest the moment at or before it (a gap in the candles must not hide the
 * marker); the first bar when the moment precedes them all; null without bars.
 */
export function barAtOrBefore(times: readonly number[], atSec: number): number | null {
  if (times.length === 0) return null;
  let lo = 0;
  let hi = times.length - 1;
  if (atSec < times[0]) return times[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= atSec) lo = mid; else hi = mid - 1;
  }
  return times[lo];
}

import { WEB_MAX_1M_RANGE_DAYS, gridServes, type WebLiqProfileResponse } from '@trade-automation/contracts';

/**
 * IB-153 — what the liquidation profile asks for, from what the price pane shows.
 *
 * The chart reports its view on every repaint (`liq-profile.primitive.ts`): the visible bars and the price
 * span. This turns that into the request, and says whether the answer on hand still serves it, so most
 * repaints (a crosshair move, a vertical scroll inside the cover) cost nothing.
 */
export interface ProfileView {
  symbol: string;
  /** [fromMs, toMs): the visible bars, from the first one's open to the last one's close, not past now. */
  fromMs: number;
  toMs: number;
  /** The price span the pane shows. */
  lo: number;
  hi: number;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/**
 * The time window for the visible bars `[fromSec, toSec]` (bar opens) of `barSec` each:
 * - **to** is the last bar's close, but no later than the end of the current minute, so the future
 *   whitespace slots right of the last candle (IB-067) do not widen it and the live edge moves once a
 *   minute, not on every 5 s candle tick;
 * - **from** is the first bar's open, clamped to 90 days before `to` — the tape reads' rule
 *   (`WEB_MAX_1M_RANGE_DAYS`, as `sideWindow`): on a two-year weekly view the profile is its last 90 days.
 * Null when nothing of the view is before now.
 */
export function profileWindow(fromSec: number, toSec: number, barSec: number, nowMs: number): { fromMs: number; toMs: number } | null {
  const liveEdge = Math.ceil((nowMs + 1) / MINUTE_MS) * MINUTE_MS;
  const toMs = Math.min((toSec + barSec) * 1000, liveEdge);
  const fromMs = Math.max(fromSec * 1000, toMs - WEB_MAX_1M_RANGE_DAYS * DAY_MS);
  return toMs > fromMs ? { fromMs, toMs } : null;
}

/** True when `answer` was read for this view's coin and window, and its grid still serves the price span. */
export function answerServes(answer: WebLiqProfileResponse | null, view: ProfileView): boolean {
  return answer !== null && answer.symbol === view.symbol && answer.from === view.fromMs && answer.to === view.toMs
    && gridServes(answer, view.lo, view.hi);
}

/** Two views that would make the same request (the price span by its grid, as the server keys it). */
export function sameView(a: ProfileView | null, b: ProfileView): boolean {
  return a !== null && a.symbol === b.symbol && a.fromMs === b.fromMs && a.toMs === b.toMs && a.lo === b.lo && a.hi === b.hi;
}

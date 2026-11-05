import type { WebLiquidationEpisodePrice } from '@trade-automation/contracts';

/**
 * IB-133 (liquidation-episodes design E6, E8) — an episode's price path: Binance perp 1-minute closes
 * of its largest coin from `from − 60 min` to `to + 240 min`, as ONE exact-limit request
 * (`closedKlines`, ~300–330 bars → weight 2). Pure: the window to ask for, and the facts from what came
 * back. Facts about the past only (D20): «во время a → b», «через 4 ч c», never a forecast.
 */

export const PATH_BEFORE_MIN = 60;
export const PATH_AFTER_MIN = 240;
/** `/fapi/v1/klines` serves at most 1 500 rows a request; a longer episode's path ends early. */
export const PATH_MAX_BARS = 1_500;

const MINUTE_MS = 60_000;

export interface PathWindow {
  /** The first bar's open, ms. */
  fromMs: number;
  limit: number;
  /** The open (ms) of the minute holding `from`, of `to`, and of `to + 4 h`. */
  startMinuteMs: number;
  endMinuteMs: number;
  after4hMinuteMs: number;
}

export function pathWindow(fromMs: number, toMs: number): PathWindow {
  const startMinuteMs = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS;
  const endMinuteMs = Math.floor(toMs / MINUTE_MS) * MINUTE_MS;
  const after4hMinuteMs = endMinuteMs + PATH_AFTER_MIN * MINUTE_MS;
  const first = startMinuteMs - PATH_BEFORE_MIN * MINUTE_MS;
  return {
    fromMs: first,
    limit: Math.min(PATH_MAX_BARS, (after4hMinuteMs - first) / MINUTE_MS + 1),
    startMinuteMs,
    endMinuteMs,
    after4hMinuteMs,
  };
}

/** True once the minute at `to + 4 h` has closed: the path is final and can be kept for a day. */
export function pathComplete(w: PathWindow, nowMs: number): boolean {
  return nowMs >= w.after4hMinuteMs + MINUTE_MS;
}

/**
 * The facts from the closed 1m bars that came back (`time` = open, sec). Null when the episode's own
 * minutes are not there: the coin did not trade then, or `to`'s minute has not closed yet (an episode
 * still running) — the caller does not cache that null.
 */
export function priceFacts(
  symbol: string,
  bars: ReadonlyArray<{ time: number; open: number; close: number }>,
  w: PathWindow,
): WebLiquidationEpisodePrice | null {
  const at = new Map(bars.map((b) => [b.time * 1000, b]));
  const start = at.get(w.startMinuteMs);
  const end = at.get(w.endMinuteMs);
  if (!start || !end || !(start.open > 0) || !(end.close > 0)) return null;
  const after = at.get(w.after4hMinuteMs);
  return {
    symbol,
    points: [...bars]
      .filter((b) => b.time * 1000 >= w.fromMs && b.time * 1000 <= w.after4hMinuteMs && b.close > 0)
      .sort((a, b) => a.time - b.time)
      .map((b) => ({ time: b.time, close: b.close })),
    startOpen: start.open,
    endClose: end.close,
    after4hClose: after && after.close > 0 ? after.close : null,
  };
}

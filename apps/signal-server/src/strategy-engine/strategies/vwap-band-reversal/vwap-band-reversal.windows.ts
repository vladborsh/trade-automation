import { Candle } from '@trade-automation/contracts';

const DAY_MS = 86_400_000;

export interface Windows {
  mainWindow: readonly Candle[];
  biasWindow: readonly Candle[];
}

/**
 * architecture/vwap-band-reversal-plugin.md §2.2 — both slices are by timestamp, never by
 * count (the tape has gaps). Shared between the strategy (via ctx.window('1m')) and the
 * parity test (via CandleCache.window) so both exercise the identical slicing rule.
 *
 * - main window M: `[now - mainWindowMinutes, now]`, both ends inclusive.
 * - bias window B: `[utcMidnight(now) + 1min, now]` — the 00:00 bar is excluded,
 *   bug-faithfully (`getHighTimeFrameBias`'s `add(startOfDay(endDate), {minutes: 1})`).
 */
export function sliceWindows(bars: readonly Candle[], now: number, mainWindowMinutes: number): Windows {
  const mainWindowMs = mainWindowMinutes * 60_000;
  const mainWindow = bars.filter((b) => b.openTime >= now - mainWindowMs && b.openTime <= now);
  const utcMidnight = now - (now % DAY_MS);
  const biasWindow = bars.filter((b) => b.openTime >= utcMidnight + 60_000 && b.openTime <= now);
  return { mainWindow, biasWindow };
}

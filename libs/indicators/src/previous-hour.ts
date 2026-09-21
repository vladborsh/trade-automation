import { Candle } from '@trade-automation/contracts';

export interface PreviousHourResult {
  prevFound: boolean;
  prevHigh?: number;
  prevLow?: number;
  /** openTime of the earliest matched bar — used only for drawing the swept-level overlay. */
  firstBarTime?: number;
}

const HOUR_MS = 3_600_000;

/**
 * knowledge/vwap-band-reversal-ict.md §6
 * (cmc-bot-main/src/indicator/tools/previous-hour-lh.indicator.ts) — the previous UTC clock
 * hour's high/low, scanned over `bars[0 .. n-2]` (the last bar excluded). `now` is the last
 * bar's openTime; "previous hour" = `[floor((now-1h)/1h)*1h, that + 59min]`, both ends
 * inclusive — plain UTC-ms arithmetic on `openTime`, matching the bot's
 * `add(openTime, {hours: -1})` + `setMinutes(0)`/`setMinutes(59)` on a UTC-pinned host.
 */
export function computePreviousHourLH(bars: readonly Candle[], now: number): PreviousHourResult {
  const n = bars.length;
  if (n === 0) return { prevFound: false };

  const targetHourStart = Math.floor((now - HOUR_MS) / HOUR_MS) * HOUR_MS;
  const targetHourEnd = targetHourStart + 59 * 60_000;

  let prevHigh: number | undefined;
  let prevLow: number | undefined;
  let firstBarTime: number | undefined;

  for (let i = 0; i < n - 1; i++) {
    const bar = bars[i];
    if (bar.openTime < targetHourStart || bar.openTime > targetHourEnd) continue;
    prevHigh = prevHigh === undefined ? bar.high : Math.max(prevHigh, bar.high);
    prevLow = prevLow === undefined ? bar.low : Math.min(prevLow, bar.low);
    firstBarTime = firstBarTime === undefined ? bar.openTime : Math.min(firstBarTime, bar.openTime);
  }

  return { prevFound: prevHigh !== undefined, prevHigh, prevLow, firstBarTime };
}

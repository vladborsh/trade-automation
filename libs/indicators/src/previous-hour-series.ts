import { Candle } from '@trade-automation/contracts';
import { IndicatorSeries } from './series';

const HOUR_MS = 3_600_000;
const LAST_MINUTE_MS = 59 * 60_000;

/**
 * T-034 — the series form of the lifted `computePreviousHourLH` (previous-hour.ts, unchanged): the
 * value at bar i is `computePreviousHourLH(bars[0..i], bars[i].openTime)` — the high and low of the
 * bars whose openTime lies in the **previous UTC clock hour** of bar i, `[H − 1h, H − 1h + 59 min]`
 * with both ends inclusive, where H is bar i's hour. Anchored to UTC hour boundaries by `openTime`
 * arithmetic, as the plug-in; so it steps once per hour and runs straight across midnight (the
 * 00:xx bars read 23:00–23:59 of the previous day).
 *
 * No point where that hour has no bars (a data gap, or a timeframe above 1 h, whose bars do not
 * open inside the previous hour). Bars must be in ascending openTime order. One pass, O(n); max/min
 * are exact. Output series: `high`, `low`.
 */
export function previousHourSeries(bars: readonly Candle[]): IndicatorSeries<'high' | 'low'> {
  const high: IndicatorSeries['high'] = [];
  const low: IndicatorSeries['low'] = [];

  let hourStart = Number.NaN; // the hour being accumulated
  let hourHigh: number | undefined;
  let hourLow: number | undefined;
  let prevStart = Number.NaN; // the last completed hour that had bars in its first 59 minutes
  let prevHigh: number | undefined;
  let prevLow: number | undefined;

  for (const bar of bars) {
    const start = Math.floor(bar.openTime / HOUR_MS) * HOUR_MS;
    if (start !== hourStart) {
      if (hourHigh !== undefined) {
        prevStart = hourStart;
        prevHigh = hourHigh;
        prevLow = hourLow;
      }
      hourStart = start;
      hourHigh = undefined;
      hourLow = undefined;
    }
    if (prevStart === start - HOUR_MS && prevHigh !== undefined && prevLow !== undefined) {
      high.push({ time: bar.openTime, value: prevHigh });
      low.push({ time: bar.openTime, value: prevLow });
    }
    if (bar.openTime - start <= LAST_MINUTE_MS) {
      hourHigh = hourHigh === undefined ? bar.high : Math.max(hourHigh, bar.high);
      hourLow = hourLow === undefined ? bar.low : Math.min(hourLow, bar.low);
    }
  }
  return { high, low };
}

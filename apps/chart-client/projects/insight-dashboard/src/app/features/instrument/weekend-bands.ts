import type { EconomicEvent } from '@trade-automation/contracts';
import { barsWithin } from './time-grid';
import type { TimeBand } from './time-marks.primitive';
import { zonedTimeToUtc } from './trading-sessions';

/**
 * IB-060 — the hours the US market is shut, shaded on every pane: Saturday and Sunday by UTC,
 * and each US holiday the calendar carries (impact `holiday`, currency USD) as the whole New York
 * day it names. Crypto trades through both, which is the point of shading them: liquidity and
 * behaviour differ while the US is away.
 *
 * Pure: which bars a band spans. Up to 4h only — on 1d a band is a bar, and the bars ARE the days.
 */

export const CLOSED_BAND_COLOUR = 'rgba(139, 148, 158, 0.10)';
/** The legend swatch: the same grey, opaque, because a 10 % fill is invisible at 8 px. */
export const CLOSED_BAND_SWATCH = '#8b949e';

const DAY_SEC = 86_400;

/** Off on 1d and 1w: a weekend is one or two whole bars there, or part of one (IB-065). */
export function showsClosedBands(timeframe: string): boolean {
  return timeframe !== '1d' && timeframe !== '1w';
}

/** Saturday 00:00 UTC to Monday 00:00 UTC, for every weekend the candles touch. */
function weekendRanges(firstSec: number, lastSec: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const start = Math.floor(firstSec / DAY_SEC) * DAY_SEC - 2 * DAY_SEC;
  for (let day = start; day <= lastSec; day += DAY_SEC) {
    if (new Date(day * 1000).getUTCDay() === 6) out.push([day, day + 2 * DAY_SEC]);
  }
  return out;
}

/** The New York calendar day a USD holiday names (`scheduledDay`, the ET day), as UTC instants. */
function holidayRange(e: EconomicEvent): [number, number] {
  const [y, m, d] = e.scheduledDay.split('-').map(Number);
  const day = Date.UTC(y, m - 1, d) / 1000;
  return [zonedTimeToUtc('America/New_York', day, 0), zonedTimeToUtc('America/New_York', day + DAY_SEC, 0)];
}

export function closedBands(times: readonly number[], timeframe: string, events: readonly EconomicEvent[]): TimeBand[] {
  if (times.length === 0 || !showsClosedBands(timeframe)) return [];
  const holidays = events.filter((e) => e.country === 'USD' && e.impact === 'holiday' && e.status !== 'removed');
  const ranges = [...weekendRanges(times[0], times[times.length - 1]), ...holidays.map(holidayRange)];
  const out: TimeBand[] = [];
  for (const [from, to] of ranges) {
    const bars = barsWithin(times, from, to);
    if (bars) out.push({ ...bars, colour: CLOSED_BAND_COLOUR });
  }
  return out.sort((a, b) => a.first - b.first);
}

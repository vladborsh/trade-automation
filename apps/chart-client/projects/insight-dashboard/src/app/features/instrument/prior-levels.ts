import {
  monthOpens, previousDayLevels, previousMonthLevels, previousWeekLevels, weekOpens,
  type LevelPeriod, type OpenPeriod,
} from '@trade-automation/market-data-core';
import type { WebCandle } from '@trade-automation/contracts';
import type { ChartLayer } from './chart-prefs';
import { barsWithin } from './time-grid';

/**
 * The level lines as the chart draws them: PDH/PDL/PWH/PWL, and since IB-129 PMH/PML, WO and MO. The levels
 * themselves are computed by `libs/market-data-core` (`prior-levels.ts`, moved there by IB-126, design P1).
 * Their axis titles are identifiers and stay English (§11, C3).
 */

/**
 * One colour per period: purple for the day's pair, orange for the week's; IB-129: blue for the month's pair,
 * and the text colour for the two opens (the muted grey is the closed-band swatch's), told apart by their dash and their axis title.
 */
export const LEVEL_COLOURS = { day: '#bc8cff', week: '#f0883e', month: '#58a6ff', open: '#c9d1d9' } as const;

/** A point of a line series; no `value` is a gap the chart leaves undrawn. */
export interface StepPoint {
  time: number;
  value?: number;
}

/**
 * One level as a step line on the candle grid: a point on each period's first and last bar (so a
 * one-bar period is still drawn, and the line reaches the period's end), and a gap where a period
 * has no level, so the line never carries yesterday's value across a day it does not describe.
 * Every point is a time in `times`: an indicator never adds a slot to the time scale.
 */
export function levelSteps(periods: readonly LevelPeriod[], times: readonly number[], pick: 'high' | 'low'): StepPoint[] {
  const out: StepPoint[] = [];
  periods.forEach((p, i) => {
    const bars = barsWithin(times, p.start, p.end);
    if (bars) {
      out.push({ time: bars.first, value: p[pick] });
      if (bars.last !== bars.first) out.push({ time: bars.last, value: p[pick] });
    }
    const next = periods[i + 1];
    if (next && next.start !== p.end) {
      const gap = barsWithin(times, p.end, next.start);
      if (gap && out.length > 0) out.push({ time: gap.first });
    }
  });
  return out;
}

/** How a level line is dashed: the high/low pairs dashed (as before IB-129), the weekly open dotted, the monthly open sparse. */
export type LevelDash = 'dashed' | 'dotted' | 'sparse';

export interface LevelLine {
  title: string;
  colour: string;
  dash: LevelDash;
  points: StepPoint[];
}

/** An open as a one-value period, so `levelSteps` draws it like a high or a low. */
const asLevel = (p: OpenPeriod): LevelPeriod => ({ start: p.start, end: p.end, high: p.open, low: p.open });

/**
 * IB-129 — every level line the price pane draws, from the daily candles, on the candle times: PDH/PDL and
 * PWH/PWL (always, as before), and PMH/PML, the weekly open (WO) and the monthly open (MO) unless their
 * legend switch is off (`off`). The levels come from `libs/market-data-core`, the module the level alerts
 * read too (design P1), so a line and an alert cannot disagree. A line with no point in the window is left out.
 * On 1w a day is inside a bar, so the day's pair is left out (IB-065).
 */
export function levelLines(
  daily: readonly WebCandle[], times: readonly number[], timeframe: string,
  off: Readonly<Partial<Record<ChartLayer, boolean>>> = {},
): LevelLine[] {
  const day = previousDayLevels(daily);
  const week = previousWeekLevels(daily);
  const month = previousMonthLevels(daily);
  const lines: Array<Omit<LevelLine, 'points'> & { periods: LevelPeriod[]; pick: 'high' | 'low' }> = [
    ...(timeframe === '1w' ? [] : [
      { title: 'PDH', colour: LEVEL_COLOURS.day, dash: 'dashed' as const, periods: day, pick: 'high' as const },
      { title: 'PDL', colour: LEVEL_COLOURS.day, dash: 'dashed' as const, periods: day, pick: 'low' as const },
    ]),
    { title: 'PWH', colour: LEVEL_COLOURS.week, dash: 'dashed', periods: week, pick: 'high' },
    { title: 'PWL', colour: LEVEL_COLOURS.week, dash: 'dashed', periods: week, pick: 'low' },
    ...(off.prevMonth ? [] : [
      { title: 'PMH', colour: LEVEL_COLOURS.month, dash: 'dashed' as const, periods: month, pick: 'high' as const },
      { title: 'PML', colour: LEVEL_COLOURS.month, dash: 'dashed' as const, periods: month, pick: 'low' as const },
    ]),
    ...(off.weekOpen ? [] : [{ title: 'WO', colour: LEVEL_COLOURS.open, dash: 'dotted' as const, periods: weekOpens(daily).map(asLevel), pick: 'high' as const }]),
    ...(off.monthOpen ? [] : [{ title: 'MO', colour: LEVEL_COLOURS.open, dash: 'sparse' as const, periods: monthOpens(daily).map(asLevel), pick: 'high' as const }]),
  ];
  return lines
    .map(({ periods, pick, ...line }) => ({ ...line, points: levelSteps(periods, times, pick) }))
    .filter((l) => l.points.length > 0);
}

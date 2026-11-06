import type { LevelPeriod } from '@trade-automation/market-data-core';
import { barsWithin } from './time-grid';

/**
 * The PDH/PDL/PWH/PWL lines as the chart draws them. The levels themselves are computed by
 * `libs/market-data-core` (`prior-levels.ts`, moved there by IB-126, design P1).
 */

/** One colour per period: purple for the day's pair, orange for the week's. */
export const LEVEL_COLOURS = { day: '#bc8cff', week: '#f0883e' } as const;

/** The four lines and their axis titles, which are identifiers and stay English (§11). */
export const LEVEL_LINES = [
  { title: 'PDH', period: 'day', pick: 'high' },
  { title: 'PDL', period: 'day', pick: 'low' },
  { title: 'PWH', period: 'week', pick: 'high' },
  { title: 'PWL', period: 'week', pick: 'low' },
] as const;

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

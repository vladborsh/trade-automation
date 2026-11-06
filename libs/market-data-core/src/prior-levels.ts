import type { WebCandle } from '@trade-automation/contracts';

/**
 * IB-126 (design P1): moved here from the dashboard's `features/instrument/prior-levels.ts` unchanged, so the
 * dashboard's lines and the bot's level alerts read one module.
 *
 * Previous day and previous week high/low (PDH/PDL, PWH/PWL) on the price pane (2026-10-24, §13).
 *
 * **Computed from 1d candles fetched for the purpose, not from the candles on screen**: on 1m the
 * page loads one day, which has no previous day in it. `instrument-window.ts` reads the window's
 * daily candles plus the two weeks before it, so the first day and the first ISO week on screen
 * both have a complete previous period.
 *
 * Periods are UTC: a day starts 00:00 UTC, an ISO week Monday 00:00 UTC. A week's levels need all
 * seven of its daily candles: a week read half-way through its history would draw a "previous
 * week" low that is only the low of its last three days. No level is better than a wrong one.
 */

const DAY_SEC = 86_400;
const WEEK_SEC = 7 * DAY_SEC;

export interface LevelPeriod {
  /** The period the level is drawn across, `[start, end)` in epoch seconds. */
  start: number;
  end: number;
  /** The PREVIOUS period's high and low. */
  high: number;
  low: number;
}

/** The ISO week a time falls in, as its Monday 00:00 UTC. 1970-01-01 was a Thursday. */
export function isoWeekStart(timeSec: number): number {
  const day = Math.floor(timeSec / DAY_SEC);
  const sinceMonday = (day + 3) % 7;
  return (day - sinceMonday) * DAY_SEC;
}

/** Each day drawn at the day before's high and low; a day whose predecessor is missing gets none. */
export function previousDayLevels(daily: readonly WebCandle[]): LevelPeriod[] {
  return byTime(daily).map((d) => ({ start: d.time + DAY_SEC, end: d.time + 2 * DAY_SEC, high: d.high, low: d.low }));
}

/** Each ISO week drawn at the week before's high and low, from complete weeks only. */
export function previousWeekLevels(daily: readonly WebCandle[]): LevelPeriod[] {
  const weeks = new Map<number, WebCandle[]>();
  for (const d of byTime(daily)) {
    const w = isoWeekStart(d.time);
    weeks.set(w, [...(weeks.get(w) ?? []), d]);
  }
  const out: LevelPeriod[] = [];
  for (const [week, days] of weeks) {
    if (days.length !== 7) continue;
    out.push({
      start: week + WEEK_SEC,
      end: week + 2 * WEEK_SEC,
      high: days.reduce((m, d) => Math.max(m, d.high), -Infinity),
      low: days.reduce((m, d) => Math.min(m, d.low), Infinity),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

function byTime(daily: readonly WebCandle[]): WebCandle[] {
  const m = new Map<number, WebCandle>();
  for (const d of daily) m.set(d.time, d);
  return [...m.values()].sort((a, b) => a.time - b.time);
}

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

// ------------------------------------------------------------------------------------------------
// IB-126 (design P1, P2): the previous calendar month, and the weekly and monthly opens, for the
// level alerts (and the chart's lines later, IB-129). The same rules: UTC, ISO weeks, complete
// periods only.
// ------------------------------------------------------------------------------------------------

/** The calendar month a time falls in, as its 1st 00:00 UTC, epoch seconds. */
export function monthStart(timeSec: number): number {
  const d = new Date(timeSec * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

/** The first moment of the month after the one `timeSec` falls in. */
export function nextMonthStart(timeSec: number): number {
  const d = new Date(timeSec * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}

/**
 * Each calendar month drawn at the month before's high and low, from complete months only: a month
 * needs one daily candle for every one of its days (28–31).
 */
export function previousMonthLevels(daily: readonly WebCandle[]): LevelPeriod[] {
  const months = new Map<number, WebCandle[]>();
  for (const d of byTime(daily)) {
    const m = monthStart(d.time);
    months.set(m, [...(months.get(m) ?? []), d]);
  }
  const out: LevelPeriod[] = [];
  for (const [month, days] of months) {
    const next = nextMonthStart(month);
    if (days.length !== (next - month) / DAY_SEC) continue;
    out.push({
      start: next,
      end: nextMonthStart(next),
      high: days.reduce((m, d) => Math.max(m, d.high), -Infinity),
      low: days.reduce((m, d) => Math.min(m, d.low), Infinity),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A period's opening price, in force across `[start, end)`. */
export interface OpenPeriod {
  start: number;
  end: number;
  open: number;
}

/**
 * Each ISO week's open: the open of its Monday's daily candle. A week whose Monday candle is
 * missing gets none (the first candle on file is not the week's open). The candle may still be
 * forming: its open is final the moment it exists.
 */
export function weekOpens(daily: readonly WebCandle[]): OpenPeriod[] {
  return byTime(daily)
    .filter((d) => isoWeekStart(d.time) === d.time)
    .map((d) => ({ start: d.time, end: d.time + WEEK_SEC, open: d.open }));
}

/** Each calendar month's open: the open of its 1st's daily candle, under the same rule. */
export function monthOpens(daily: readonly WebCandle[]): OpenPeriod[] {
  return byTime(daily)
    .filter((d) => monthStart(d.time) === d.time)
    .map((d) => ({ start: d.time, end: nextMonthStart(d.time), open: d.open }));
}

/** One level in force: the kind's id (contracts' `LevelKind`), its price and its period, epoch seconds. */
export interface PriorLevel {
  kind: 'PWH' | 'PWL' | 'PMH' | 'PML' | 'WO' | 'MO' | 'PDH' | 'PDL';
  price: number;
  start: number;
  end: number;
}

/**
 * Every level in force at `atSec`, from the daily candles given: PDH/PDL, PWH/PWL, PMH/PML, the
 * weekly and the monthly open. A level whose previous period is incomplete (or whose opening candle
 * is missing) is absent, never approximated. Ordered as listed.
 */
export function levelsInForce(daily: readonly WebCandle[], atSec: number): PriorLevel[] {
  const at = <T extends { start: number; end: number }>(ps: readonly T[]): T | undefined => ps.find((p) => p.start <= atSec && atSec < p.end);
  const out: PriorLevel[] = [];
  const pair = (p: LevelPeriod | undefined, hi: PriorLevel['kind'], lo: PriorLevel['kind']) => {
    if (!p) return;
    out.push({ kind: hi, price: p.high, start: p.start, end: p.end }, { kind: lo, price: p.low, start: p.start, end: p.end });
  };
  const open = (p: OpenPeriod | undefined, kind: PriorLevel['kind']) => {
    if (p) out.push({ kind, price: p.open, start: p.start, end: p.end });
  };
  pair(at(previousDayLevels(daily)), 'PDH', 'PDL');
  pair(at(previousWeekLevels(daily)), 'PWH', 'PWL');
  pair(at(previousMonthLevels(daily)), 'PMH', 'PML');
  open(at(weekOpens(daily)), 'WO');
  open(at(monthOpens(daily)), 'MO');
  return out;
}

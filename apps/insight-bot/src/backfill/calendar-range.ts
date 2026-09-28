/**
 * IB-012 — the month and day grids the backfill walks (§5).
 *
 * Everything is UTC and everything is a string (`2026-09`, `2026-09-27`), because that is what
 * the archive's file names are; converting to Date and back is where off-by-one-day bugs live.
 */

export type Month = string; // YYYY-MM
export type Day = string; // YYYY-MM-DD

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertMonth(month: string): Month {
  if (!MONTH_RE.test(month)) throw new Error(`not a YYYY-MM month: ${month}`);
  return month;
}

export function assertDay(day: string): Day {
  if (!DAY_RE.test(day)) throw new Error(`not a YYYY-MM-DD day: ${day}`);
  return day;
}

export function monthOf(day: Day | Month): Month {
  return day.slice(0, 7);
}

export function monthStart(month: Month): Date {
  return new Date(`${assertMonth(month)}-01T00:00:00.000Z`);
}

export function nextMonth(month: Month): Month {
  const [y, m] = assertMonth(month).split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Inclusive of both ends; an empty list when `to` is before `from`. */
export function monthsBetween(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = assertMonth(from); m <= assertMonth(to); m = nextMonth(m)) out.push(m);
  return out;
}

export function daysInMonth(month: Month): Day[] {
  const start = monthStart(month);
  const out: Day[] = [];
  for (const d = new Date(start); monthOf(d.toISOString().slice(0, 10)) === month; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10) as Day);
  }
  return out;
}

/** Inclusive of both ends. */
export function daysBetween(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (const d = new Date(`${assertDay(from)}T00:00:00.000Z`); d.toISOString().slice(0, 10) <= assertDay(to); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10) as Day);
  }
  return out;
}

/**
 * The last month that has a *monthly* archive file: the current month is only served as daily
 * files, so asking for its monthly zip is a guaranteed 404.
 */
export function lastCompleteMonth(now: Date): Month {
  const m = now.toISOString().slice(0, 7);
  const [y, mm] = m.split('-').map(Number);
  return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`;
}

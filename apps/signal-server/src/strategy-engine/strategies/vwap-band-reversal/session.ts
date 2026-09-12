import { ZonedTime } from '../../clock';

export type EntryWindow = readonly [string, string]; // ["hh:mm", "hh:mm"], NY wall-clock, inclusive

function minutesOfDay(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * knowledge/vwap-band-reversal-ict.md §8 (`isValidTimeForNewOrders`) —
 * architecture/vwap-band-reversal-plugin.md §2.5: `zoned` (the session-timezone wall clock via
 * ctx.clock.toZoned) falls inside `window` inclusive at both ends, AND the bar's **UTC**
 * weekday is Mon-Fri (the bot's `getDay(timestamp)` on a UTC host — computed from `now`
 * directly via `getUTCDay()`, not from the zoned wall clock, since a UTC weekday and an NY
 * weekday can disagree for the ~4-5 hours around UTC midnight). For every window this strategy
 * uses, the UTC and NY calendar dates coincide (§2.5's equivalence note), so this predicate is
 * exactly the bot's.
 */
export function isWithinEntryWindow(now: number, zoned: ZonedTime, window: EntryWindow): boolean {
  const utcWeekday = new Date(now).getUTCDay();
  if (utcWeekday < 1 || utcWeekday > 5) return false;

  const current = zoned.hour * 60 + zoned.minute;
  return current >= minutesOfDay(window[0]) && current <= minutesOfDay(window[1]);
}

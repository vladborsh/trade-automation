import { toZonedTime } from 'date-fns-tz';

export interface ZonedTime {
  date: Date;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

/**
 * architecture/live-signal-server.md §4.4, §4.6 — "All wall-clock/session logic lives inside
 * strategies via ctx.clock.toZoned (date-fns-tz, as the bot uses), never in shared
 * infrastructure." DST-correct; no Date-local anywhere.
 */
export function toZoned(ms: number, tz: string): ZonedTime {
  const date = toZonedTime(new Date(ms), tz);
  return { date, hour: date.getHours(), minute: date.getMinutes(), weekday: date.getDay() };
}

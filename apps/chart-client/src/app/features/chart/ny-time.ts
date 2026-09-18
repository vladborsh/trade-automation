import { TickMarkType, type Time } from 'lightweight-charts';
import type { Timeframe } from '@trade-automation/contracts';

/**
 * New York wall-clock display of the chart's real-UTC timestamps (architecture/chart-layouts.md
 * §12.2). Formatting only: every timestamp handed to lightweight-charts stays UTC epoch seconds.
 *
 * The UTC→NY offset comes from the tz database via a cached `Intl.DateTimeFormat` (DST-correct,
 * no fixed offset). America/New_York only ever changes offset on a whole UTC hour, so the offset
 * is memoised per UTC hour — thousands of bars cost a map lookup each, not a `formatToParts`.
 */
const NY_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const HOUR_SEC = 3600;
const DAY_SEC = 86_400;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const offsetByUtcHour = new Map<number, number>();
const OFFSET_CACHE_MAX = 50_000;

/** NY minus UTC, in seconds (−4 h in EDT, −5 h in EST) at the UTC hour containing `sec`. */
function nyOffsetSec(sec: number): number {
  const hour = Math.floor(sec / HOUR_SEC);
  const cached = offsetByUtcHour.get(hour);
  if (cached !== undefined) {
    return cached;
  }
  const at = hour * HOUR_SEC;
  const p: Record<string, number> = {};
  for (const part of NY_FORMAT.formatToParts(new Date(at * 1000))) {
    if (part.type !== 'literal') {
      p[part.type] = Number(part.value);
    }
  }
  const offset = Date.UTC(p['year'], p['month'] - 1, p['day'], p['hour'], p['minute'], p['second']) / 1000 - at;
  if (offsetByUtcHour.size >= OFFSET_CACHE_MAX) {
    offsetByUtcHour.clear();
  }
  offsetByUtcHour.set(hour, offset);
  return offset;
}

export interface NyParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
}

/** NY wall-clock fields of a UTC epoch-seconds instant. */
export function nyParts(sec: number): NyParts {
  const d = new Date((sec + nyOffsetSec(sec)) * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** Days since 1970-01-01 of the NY calendar day containing `sec` — a cheap `nyDayKey` for comparisons. */
export function nyDayNumber(sec: number): number {
  return Math.floor((sec + nyOffsetSec(sec)) / DAY_SEC);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of the NY calendar day containing `sec`. */
export function nyDayKey(sec: number): string {
  const p = nyParts(sec);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Axis label (§12.2). The library picks tick positions and weights in UTC, so the label follows
 * the tick's NY wall-clock instead of its weight: year/month ticks → NY year/month; a tick at NY
 * 00:00 → the NY date; any other intraday tick → NY `HH:mm`. On `1d` bars (all opening at a
 * non-midnight NY time) day ticks show the NY date — `HH:mm` would be the same on every tick.
 */
export function nyTickLabel(sec: number, tickMarkType: TickMarkType, tf?: Timeframe): string {
  const p = nyParts(sec);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return String(p.year);
    case TickMarkType.Month:
      return MONTHS[p.month - 1];
    case TickMarkType.DayOfMonth:
      if (tf === '1d') {
        return String(p.day);
      }
      break;
  }
  if (p.hour === 0 && p.minute === 0) {
    return `${p.day} ${MONTHS[p.month - 1]}`;
  }
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Crosshair time label, e.g. `Sun 08 Mar '26 20:00` (NY wall-clock). */
export function nyCrosshairLabel(sec: number): string {
  const p = nyParts(sec);
  return `${WEEKDAYS[p.weekday]} ${pad2(p.day)} ${MONTHS[p.month - 1]} '${pad2(p.year % 100)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** lightweight-charts hands `Time` back as given — the client only ever gives it UTC epoch seconds. */
function timeToSec(time: Time): number {
  if (typeof time === 'number') {
    return time;
  }
  if (typeof time === 'string') {
    return Date.parse(time) / 1000;
  }
  return Date.UTC(time.year, time.month - 1, time.day) / 1000;
}

/** `timeScale.tickMarkFormatter` for a chart on timeframe `tf`. */
export function nyTickMarkFormatter(tf?: Timeframe): (time: Time, tickMarkType: TickMarkType) => string {
  return (time, tickMarkType) => nyTickLabel(timeToSec(time), tickMarkType, tf);
}

/** `localization.timeFormatter` (crosshair label). */
export function nyTimeFormatter(time: Time): string {
  return nyCrosshairLabel(timeToSec(time));
}

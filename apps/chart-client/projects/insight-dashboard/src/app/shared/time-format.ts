/**
 * IB-152 (owner ruling A, 2026-11-06): one time format and one time zone on every page.
 *
 * **The rule, in one place** (the coordinator's default; the owner may change it, so change it HERE):
 * - a moment is shown in the **viewer's own zone** (the browser's), as `dd.MM HH:mm`, 24 h — `06.11 17:15`;
 * - the variants come from the same parts: `HH:mm`, `dd.MM`, `dd.MM.yyyy`, and `dd.MM HH:mm:ss` where the
 *   seconds matter (the admin sign-in journal);
 * - the zone is named once per page or card where it matters, as `UTC+2` (`zoneLabel`), computed for the
 *   shown moment, so it is right on both sides of a DST change;
 * - a **business period** (a daily candle, «день по UTC», a fear & greed day) stays a UTC day: its NAME is
 *   the UTC date (`utcDate`), because that is the period the number belongs to. Only moments move.
 *
 * Every rendered time goes through this file; `time-format.guard.spec.ts` fails on a new direct
 * `toLocale*Time/DateString`, `Intl.DateTimeFormat`, `DatePipe`, `toISOString()` or a hand-built `HH:mm`.
 *
 * `zone` is an IANA name; `undefined` (the default everywhere) is the viewer's zone. Specs pass one.
 * Inputs are unix SECONDS, as the API sends them.
 */

/** An IANA zone, or `undefined` for the viewer's own. */
export type Zone = string | undefined;

interface Parts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

/** One `Intl.DateTimeFormat` per zone: a chart's crosshair formats on every mouse move. */
const FORMATS = new Map<string, Intl.DateTimeFormat>();

function formatFor(zone: Zone): Intl.DateTimeFormat {
  const key = zone ?? '';
  let f = FORMATS.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    FORMATS.set(key, f);
  }
  return f;
}

function partsOf(sec: number, zone: Zone): Parts {
  const out: Record<string, string> = {};
  for (const p of formatFor(zone).formatToParts(new Date(sec * 1000))) out[p.type] = p.value;
  // some engines still render midnight as `24` under h23 when asked for parts; it is 00
  const hour = out['hour'] === '24' ? '00' : out['hour'];
  return { year: out['year'], month: out['month'], day: out['day'], hour, minute: out['minute'], second: out['second'] };
}

/** `06.11 17:15` — THE format. */
export function dateTime(sec: number, zone?: Zone): string {
  const p = partsOf(sec, zone);
  return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
}

/** `06.11 17:15:42` — only where the seconds matter (the admin sign-in journal). */
export function dateTimeSec(sec: number, zone?: Zone): string {
  const p = partsOf(sec, zone);
  return `${p.day}.${p.month} ${p.hour}:${p.minute}:${p.second}`;
}

/** `17:15`. */
export function timeOfDay(sec: number, zone?: Zone): string {
  const p = partsOf(sec, zone);
  return `${p.hour}:${p.minute}`;
}

/** `06.11`. */
export function dayMonth(sec: number, zone?: Zone): string {
  const p = partsOf(sec, zone);
  return `${p.day}.${p.month}`;
}

/** `06.11.2026` — where the year is not obvious (history starts, sign-up dates). */
export function dayMonthYear(sec: number, zone?: Zone): string {
  const p = partsOf(sec, zone);
  return `${p.day}.${p.month}.${p.year}`;
}

/** The NAME of the UTC day a business period is (a daily candle, a fear & greed day): `06.11`, or with the year. */
export function utcDate(sec: number, withYear = false): string {
  return withYear ? dayMonthYear(sec, 'UTC') : dayMonth(sec, 'UTC');
}

/** The zone's offset from UTC at that moment, seconds, positive east of Greenwich. DST-correct for `sec`. */
export function utcOffsetSec(sec: number, zone?: Zone): number {
  const p = partsOf(sec, zone);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000;
  return wall - Math.floor(sec);
}

/** `UTC+2`, `UTC-5`, `UTC+5:30`, `UTC` — the zone named for the shown moment. */
export function zoneLabel(sec: number, zone?: Zone): string {
  const off = utcOffsetSec(sec, zone);
  if (off === 0) return 'UTC';
  const abs = Math.abs(off);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  return `UTC${off < 0 ? '-' : '+'}${h}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`}`;
}

/** The viewer's calendar day of a moment, as a day number: «today / yesterday» compare these. */
export function dayIndex(sec: number, zone?: Zone): number {
  return Math.floor((sec + utcOffsetSec(sec, zone)) / 86_400);
}

/** The UTC day key `YYYY-MM-DD` — a DATA key (API days, lookups), never a label. */
export function utcDayKey(sec: number): string {
  const p = partsOf(sec, 'UTC');
  return `${p.year}-${p.month}-${p.day}`;
}

/** Epoch seconds of a `YYYY-MM-DD` UTC day key's midnight. */
export function utcDaySec(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 1000;
}

/** Weekday names come from `Intl` — they are the language — one formatter per language and zone. */
const WEEKDAYS = new Map<string, Intl.DateTimeFormat>();

/** `чт` / `Thu`: the weekday of a moment in a zone (the crosshair's prefix, IB-064). */
export function weekdayShort(sec: number, lang: string, zone?: Zone): string {
  const key = `${lang}|${zone ?? ''}`;
  let f = WEEKDAYS.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: zone });
    WEEKDAYS.set(key, f);
  }
  return f.format(new Date(sec * 1000));
}

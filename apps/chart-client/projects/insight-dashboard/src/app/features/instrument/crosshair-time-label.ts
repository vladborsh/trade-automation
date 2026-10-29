import type { Lang } from '../../i18n/keys';

/**
 * IB-064 (user, 2026-10-29): the crosshair's label under the chart carries the day of the week.
 *
 * `чт 29 окт 2026 14:35` / `Thu 29 Oct 2026 14:35`, and on 1d the date alone — a daily bar has no
 * time of day worth reading. Everything in UTC, like the rest of the chart: a reader east of
 * Greenwich hovering a bar at 23:00 UTC must see that bar's UTC weekday, not tomorrow's.
 *
 * Only the weekday and month names come from `Intl` (they are the language); the day, year and
 * time are assembled here so the order does not change with the locale's own date pattern.
 */
export function crosshairTimeLabel(timeSec: number, lang: Lang, timeframe: string): string {
  const date = new Date(timeSec * 1000);
  const names = namesFor(lang);
  const weekday = names.weekday.format(date);
  // ru's abbreviated months carry a full stop (`окт.`), which reads as clutter in a one-line label
  const month = names.month.formatToParts(date).find((p) => p.type === 'month')?.value.replace(/\.$/, '') ?? '';
  const day = `${weekday} ${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
  if (timeframe === '1d') return day;
  return `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

interface Names {
  weekday: Intl.DateTimeFormat;
  /** Formatted with the day, so ru gives the month as it reads in a date (`мая`, not `май`). */
  month: Intl.DateTimeFormat;
}

/** Built once per language: the label is formatted on every crosshair move. */
const NAMES = new Map<Lang, Names>();

function namesFor(lang: Lang): Names {
  let names = NAMES.get(lang);
  if (!names) {
    names = {
      weekday: new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }),
      month: new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    };
    NAMES.set(lang, names);
  }
  return names;
}

import { TickMarkType } from 'lightweight-charts';
import type { Lang } from '../../i18n/keys';
import { dateTime, dayMonth, timeOfDay, utcDate, utcOffsetSec, weekdayShort, type Zone } from '../../shared/time-format';

/**
 * The instrument chart's time labels: the crosshair's (IB-064: with the weekday) and the axis ticks.
 * IB-152 (owner ruling A): in the viewer's zone and the site's one format, through `time-format.ts`.
 *
 * - **intraday** (1m … 4h): a bar is a moment — `чт 06.11 17:15` in the viewer's zone;
 * - **1d / 1w**: a bar is a UTC day (a week: its Monday) — a business period, named by its UTC date
 *   and weekday, `чт 06.11.2026`, whatever the viewer's zone. The candle sits where it always did.
 *
 * The DATA stays UTC seconds; only these strings move.
 */
const DAILY = new Set(['1d', '1w']);

export function crosshairTimeLabel(timeSec: number, lang: Lang, timeframe: string, zone?: Zone): string {
  if (DAILY.has(timeframe)) return `${weekdayShort(timeSec, lang, 'UTC')} ${utcDate(timeSec, true)}`;
  return `${weekdayShort(timeSec, lang, zone)} ${dateTime(timeSec, zone)}`;
}

/**
 * An axis tick's label. The library picks a tick's weight from the UTC calendar and places a DAY tick on the first bar of a UTC day (where the day
 * separators are drawn too, `day-separators.ts`); in a zone that is not UTC that bar is not the local
 * midnight, so the tick says so: `06.11 02:00` in Kyiv, not a bare `06.11` that a reader takes for
 * local midnight. A local midnight that is not a UTC one gets an ordinary `00:00` time tick, if the
 * library puts a tick there at all. On 1d / 1w every tick names a UTC day (`06.11`), or a year.
 */
export function axisTickLabel(timeSec: number, weight: TickMarkType, timeframe: string, zone?: Zone): string {
  if (DAILY.has(timeframe)) return weight === TickMarkType.Year ? utcDate(timeSec, true).slice(6) : utcDate(timeSec);
  if (weight === TickMarkType.Time || weight === TickMarkType.TimeWithSeconds) return timeOfDay(timeSec, zone);
  const localMidnight = (timeSec + utcOffsetSec(timeSec, zone)) % 86_400 === 0;
  return localMidnight ? dayMonth(timeSec, zone) : dateTime(timeSec, zone);
}

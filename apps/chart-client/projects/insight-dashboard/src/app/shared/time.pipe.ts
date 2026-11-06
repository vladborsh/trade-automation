import { Pipe, type PipeTransform } from '@angular/core';
import { dateTime, dateTimeSec, dayMonth, dayMonthYear, timeOfDay, zoneLabel } from './time-format';

/** The variants of the site's one format (IB-152), by name. */
export type TimeVariant = 'datetime' | 'datetime-sec' | 'time' | 'date' | 'date-year' | 'zone';

const VARIANTS: Record<TimeVariant, (sec: number) => string> = {
  'datetime': (s) => dateTime(s),
  'datetime-sec': (s) => dateTimeSec(s),
  'time': (s) => timeOfDay(s),
  'date': (s) => dayMonth(s),
  'date-year': (s) => dayMonthYear(s),
  'zone': (s) => zoneLabel(s),
};

/**
 * IB-152: `{{ row.time | time }}` → `06.11 17:15`, in the viewer's zone; `| time: 'zone'` → `UTC+2`
 * (a null input names the zone as of now). Unix seconds in. The template-side door to `time-format.ts`,
 * replacing `DatePipe` (which the time-format guard now refuses).
 */
@Pipe({ name: 'time', standalone: true, pure: true })
export class TimePipe implements PipeTransform {
  transform(sec: number | null | undefined, variant: TimeVariant = 'datetime'): string {
    if (sec === null || sec === undefined) return variant === 'zone' ? zoneLabel(Date.now() / 1000) : '—';
    return VARIANTS[variant](sec);
  }
}

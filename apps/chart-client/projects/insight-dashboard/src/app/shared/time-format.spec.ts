import {
  dateTime, dateTimeSec, dayIndex, dayMonth, dayMonthYear, timeOfDay, utcDate, utcDayKey, utcDaySec, utcOffsetSec, zoneLabel,
} from './time-format';

const at = (iso: string): number => Date.parse(iso) / 1000;

/** 2026-11-06 15:15:42 UTC: Kyiv is UTC+2 (winter), New York UTC-5. */
const T = at('2026-11-06T15:15:42Z');

describe('time-format (IB-152): one format, the viewer\'s zone', () => {
  it('formats one moment differently in different zones — the zone is really applied', () => {
    expect(dateTime(T, 'UTC')).toBe('06.11 15:15');
    expect(dateTime(T, 'Europe/Kyiv')).toBe('06.11 17:15');
    expect(dateTime(T, 'America/New_York')).toBe('06.11 10:15');
    expect(dateTime(T, 'Asia/Tokyo')).toBe('07.11 00:15');
  });

  it('gives every variant from the same parts', () => {
    expect(dateTimeSec(T, 'Europe/Kyiv')).toBe('06.11 17:15:42');
    expect(timeOfDay(T, 'Europe/Kyiv')).toBe('17:15');
    expect(dayMonth(T, 'Asia/Tokyo')).toBe('07.11');
    expect(dayMonthYear(T, 'Asia/Tokyo')).toBe('07.11.2026');
  });

  it('writes local midnight as 00:00, never 24:00', () => {
    expect(dateTime(at('2026-11-05T22:00:00Z'), 'Europe/Kyiv')).toBe('06.11 00:00');
  });

  it('follows the DST change at the moment shown (Kyiv, 2026-10-25 01:00 UTC: +3 → +2)', () => {
    const before = at('2026-10-25T00:59:00Z');
    const after = at('2026-10-25T01:00:00Z');
    expect(dateTime(before, 'Europe/Kyiv')).toBe('25.10 03:59');
    expect(dateTime(after, 'Europe/Kyiv')).toBe('25.10 03:00');
    expect(zoneLabel(before, 'Europe/Kyiv')).toBe('UTC+3');
    expect(zoneLabel(after, 'Europe/Kyiv')).toBe('UTC+2');
    expect(utcOffsetSec(before, 'Europe/Kyiv')).toBe(3 * 3600);
    expect(utcOffsetSec(after, 'Europe/Kyiv')).toBe(2 * 3600);
  });

  it('names the zone with sign and minutes', () => {
    expect(zoneLabel(T, 'UTC')).toBe('UTC');
    expect(zoneLabel(T, 'America/New_York')).toBe('UTC-5');
    expect(zoneLabel(T, 'Asia/Kolkata')).toBe('UTC+5:30');
  });

  it('keeps a business period named by its UTC day, whatever the viewer\'s zone', () => {
    const dailyCandle = at('2026-11-06T00:00:00Z');
    expect(utcDate(dailyCandle)).toBe('06.11');
    expect(utcDate(dailyCandle, true)).toBe('06.11.2026');
    // the same instant as a MOMENT in New York is the evening before
    expect(dayMonth(dailyCandle, 'America/New_York')).toBe('05.11');
  });

  it('counts the viewer\'s days for «today / yesterday»', () => {
    // 23:30 UTC on the 6th is already the 7th in Kyiv
    const late = at('2026-11-06T23:30:00Z');
    expect(dayIndex(late, 'UTC')).toBe(dayIndex(T, 'UTC'));
    expect(dayIndex(late, 'Europe/Kyiv')).toBe(dayIndex(T, 'Europe/Kyiv') + 1);
  });

  it('round-trips a UTC day key (a data key, not a label)', () => {
    expect(utcDayKey(T)).toBe('2026-11-06');
    expect(utcDaySec('2026-11-06')).toBe(at('2026-11-06T00:00:00Z'));
  });

  describe('the default zone is the process\'s own (run under TZ=UTC and TZ=Europe/Kyiv)', () => {
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;

    it('uses the runtime zone when none is passed', () => {
      expect(dateTime(T)).toBe(dateTime(T, own));
      expect(zoneLabel(T)).toBe(zoneLabel(T, own));
      // the run's TZ really reached the runtime (ICU still spells Kyiv the old way)
      const tz = process.env['TZ'];
      if (tz) expect(own.replace('Europe/Kiev', 'Europe/Kyiv')).toBe(tz.replace('Europe/Kiev', 'Europe/Kyiv'));
    });

    it('disagrees with UTC exactly when the runtime zone is not UTC', () => {
      const offset = utcOffsetSec(T, own);
      expect(dateTime(T) === dateTime(T, 'UTC')).toBe(offset === 0);
    });
  });
});

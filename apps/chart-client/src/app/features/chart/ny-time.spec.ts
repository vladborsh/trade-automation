import { TickMarkType, type Time } from 'lightweight-charts';
import { nyCrosshairLabel, nyDayKey, nyDayNumber, nyParts, nyTickLabel, nyTickMarkFormatter, nyTimeFormatter } from './ny-time';

const sec = (iso: string): number => Date.parse(iso) / 1000;

describe('ny-time (architecture/chart-layouts.md §12.2)', () => {
  it('maps 04:00Z to NY midnight in summer (EDT)', () => {
    expect(nyParts(sec('2026-07-15T04:00:00Z'))).toEqual({ year: 2026, month: 7, day: 15, hour: 0, minute: 0, weekday: 3 });
    expect(nyDayKey(sec('2026-07-15T04:00:00Z'))).toBe('2026-07-15');
    expect(nyDayKey(sec('2026-07-15T03:59:00Z'))).toBe('2026-07-14');
  });

  it('maps 05:00Z to NY midnight in winter (EST)', () => {
    expect(nyParts(sec('2026-01-15T05:00:00Z'))).toMatchObject({ day: 15, hour: 0, minute: 0 });
    expect(nyDayKey(sec('2026-01-15T04:59:00Z'))).toBe('2026-01-14');
    expect(nyDayKey(sec('2026-01-15T05:00:00Z'))).toBe('2026-01-15');
  });

  it('handles the spring-forward day 2026-03-08 (23h NY day)', () => {
    expect(nyParts(sec('2026-03-08T05:00:00Z'))).toMatchObject({ day: 8, hour: 0 }); // EST midnight
    expect(nyParts(sec('2026-03-08T06:59:00Z'))).toMatchObject({ day: 8, hour: 1, minute: 59 });
    expect(nyParts(sec('2026-03-08T07:00:00Z'))).toMatchObject({ day: 8, hour: 3, minute: 0 }); // 02:00 skipped
    expect(nyParts(sec('2026-03-09T04:00:00Z'))).toMatchObject({ day: 9, hour: 0 }); // EDT midnight
    expect(nyDayNumber(sec('2026-03-09T04:00:00Z')) - nyDayNumber(sec('2026-03-08T05:00:00Z'))).toBe(1);
  });

  it('handles the fall-back day 2026-11-01 (25h NY day)', () => {
    expect(nyParts(sec('2026-11-01T04:00:00Z'))).toMatchObject({ day: 1, hour: 0 }); // EDT midnight
    expect(nyParts(sec('2026-11-01T05:30:00Z'))).toMatchObject({ day: 1, hour: 1, minute: 30 }); // first 01:30
    expect(nyParts(sec('2026-11-01T06:30:00Z'))).toMatchObject({ day: 1, hour: 1, minute: 30 }); // second 01:30
    expect(nyParts(sec('2026-11-02T05:00:00Z'))).toMatchObject({ day: 2, hour: 0 }); // EST midnight
    expect(nyDayKey(sec('2026-11-02T04:59:00Z'))).toBe('2026-11-01');
  });

  it('shows 1d/4h bar opens at 20:00 NY in summer and 19:00 NY in winter', () => {
    expect(nyParts(sec('2026-07-16T00:00:00Z'))).toMatchObject({ day: 15, hour: 20, minute: 0 });
    expect(nyParts(sec('2026-01-16T00:00:00Z'))).toMatchObject({ day: 15, hour: 19, minute: 0 });
    expect(nyParts(sec('2026-07-16T04:00:00Z'))).toMatchObject({ day: 16, hour: 0 }); // 4h bar at NY midnight (summer)
    expect(nyParts(sec('2026-01-16T04:00:00Z'))).toMatchObject({ day: 15, hour: 23 }); // winter 4h bar
  });

  describe('nyTickLabel', () => {
    it('labels a tick at NY 00:00 with the NY date', () => {
      expect(nyTickLabel(sec('2026-07-15T04:00:00Z'), TickMarkType.Time)).toBe('15 Jul');
      expect(nyTickLabel(sec('2026-01-15T05:00:00Z'), TickMarkType.DayOfMonth)).toBe('15 Jan');
    });

    it('labels other intraday ticks, day-weighted UTC midnights included, with NY HH:mm', () => {
      expect(nyTickLabel(sec('2026-07-16T00:00:00Z'), TickMarkType.DayOfMonth)).toBe('20:00');
      expect(nyTickLabel(sec('2026-01-16T00:00:00Z'), TickMarkType.DayOfMonth, '1h')).toBe('19:00');
      expect(nyTickLabel(sec('2026-07-15T13:30:00Z'), TickMarkType.Time)).toBe('09:30');
    });

    it('labels day ticks on 1d bars with the NY date, month/year ticks with the NY month/year', () => {
      expect(nyTickLabel(sec('2026-07-16T00:00:00Z'), TickMarkType.DayOfMonth, '1d')).toBe('15');
      expect(nyTickLabel(sec('2026-08-01T00:00:00Z'), TickMarkType.Month)).toBe('Jul'); // 20:00 NY on Jul 31
      expect(nyTickLabel(sec('2026-08-01T12:00:00Z'), TickMarkType.Month)).toBe('Aug');
      expect(nyTickLabel(sec('2027-01-01T12:00:00Z'), TickMarkType.Year)).toBe('2027');
    });
  });

  it('formats the crosshair label in NY wall-clock', () => {
    expect(nyCrosshairLabel(sec('2026-03-09T00:00:00Z'))).toBe("Sun 08 Mar '26 20:00");
    expect(nyTimeFormatter(sec('2026-01-16T00:00:00Z') as Time)).toBe("Thu 15 Jan '26 19:00");
  });

  it('wires as a lightweight-charts tick formatter', () => {
    expect(nyTickMarkFormatter('15m')(sec('2026-07-15T13:45:00Z') as Time, TickMarkType.Time)).toBe('09:45');
  });
});

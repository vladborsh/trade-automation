import { TimePipe } from './time.pipe';
import { dateTime, dateTimeSec, dayMonthYear, zoneLabel } from './time-format';

describe('TimePipe (IB-152)', () => {
  const pipe = new TimePipe();
  const T = Date.parse('2026-11-06T15:15:42Z') / 1000;

  it('renders each variant through time-format, in the runtime zone', () => {
    expect(pipe.transform(T)).toBe(dateTime(T));
    expect(pipe.transform(T, 'datetime-sec')).toBe(dateTimeSec(T));
    expect(pipe.transform(T, 'date-year')).toBe(dayMonthYear(T));
    expect(pipe.transform(T, 'zone')).toBe(zoneLabel(T));
    expect(pipe.transform(T)).toMatch(/^06\.11 \d\d:15$/);
  });

  it('a missing moment is a dash; a missing moment\'s zone is the zone now', () => {
    expect(pipe.transform(null)).toBe('—');
    expect(pipe.transform(null, 'zone')).toBe(zoneLabel(Date.now() / 1000));
  });
});

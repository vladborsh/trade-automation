import { isFetchDue, utcDay } from '../../src/collectors/calendar/fetch-schedule';

describe('calendar fetch schedule (IB-058: once per UTC day)', () => {
  const WED_1200 = Date.UTC(2026, 9, 28, 12, 0);

  it('fetches when nothing has ever been fetched', () => {
    expect(isFetchDue(WED_1200, null)).toBe(true);
  });

  it('does not fetch again on a day that already has a run', () => {
    expect(isFetchDue(WED_1200, '2026-10-28')).toBe(false);
    expect(isFetchDue(Date.UTC(2026, 9, 28, 23, 59, 59, 999), '2026-10-28')).toBe(false);
  });

  it('is due again from 00:00 UTC of the next day — not 24 h after the last run', () => {
    expect(isFetchDue(Date.UTC(2026, 9, 29, 0, 0), '2026-10-28')).toBe(true);
    expect(isFetchDue(Date.UTC(2026, 9, 28, 23, 59), '2026-10-27')).toBe(true);
  });

  it('keys the day by UTC, not by the machine zone or New York', () => {
    // 2026-10-28 23:30 ET is already the 29th in UTC
    expect(utcDay(Date.parse('2026-10-28T23:30:00-04:00'))).toBe('2026-10-29');
    expect(utcDay(Date.UTC(2026, 9, 28, 0, 0))).toBe('2026-10-28');
  });

  it('does not treat a run recorded for a later day (clock moved back) as stale', () => {
    expect(isFetchDue(WED_1200, '2026-10-29')).toBe(false);
  });
});

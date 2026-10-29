import { parseCalendarWindow, parseUpcoming, UPCOMING_LOOKBACK_MS } from '../../src/web/calendar/calendar-query';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 26);

describe('calendar query parsing (IB-059)', () => {
  it('defaults to USD, high + holiday, and makes `to` inclusive for the SQL', () => {
    expect(parseCalendarWindow(String(T0), String(T0 + 7 * DAY))).toEqual({
      ok: true,
      query: { fromMs: T0, toMs: T0 + 7 * DAY - 1, currency: 'USD', impacts: ['high', 'holiday'] },
    });
  });

  it('accepts exactly 90 days and refuses 90 days and a millisecond', () => {
    expect(parseCalendarWindow(String(T0), String(T0 + 90 * DAY)).ok).toBe(true);
    expect(parseCalendarWindow(String(T0), String(T0 + 90 * DAY + 1))).toMatchObject({ ok: false, code: 'RANGE_TOO_WIDE', maxDays: 90 });
  });

  it('refuses a missing, backwards or non-numeric range', () => {
    expect(parseCalendarWindow('', String(T0))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(parseCalendarWindow(String(T0 + DAY), String(T0))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(parseCalendarWindow('yesterday', String(T0))).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('parses impact lists and currencies, and refuses what the feed never sends', () => {
    expect(parseCalendarWindow(String(T0), String(T0 + DAY), 'eur', 'high, medium')).toMatchObject({
      ok: true, query: { currency: 'EUR', impacts: ['high', 'medium'] },
    });
    expect(parseCalendarWindow(String(T0), String(T0 + DAY), 'all')).toMatchObject({ ok: true, query: { currency: 'All' } });
    expect(parseCalendarWindow(String(T0), String(T0 + DAY), 'USD', 'huge')).toMatchObject({ code: 'BAD_REQUEST' });
    expect(parseCalendarWindow(String(T0), String(T0 + DAY), 'US$')).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('upcoming: 60 minutes of high-impact USD by default, reaching 5 minutes back', () => {
    expect(parseUpcoming(T0)).toEqual({
      ok: true,
      query: { fromMs: T0 - UPCOMING_LOOKBACK_MS, toMs: T0 + 60 * 60_000, currency: 'USD', impacts: ['high'] },
    });
  });

  it('upcoming: refuses a non-positive or over-a-day withinMin', () => {
    expect(parseUpcoming(T0, '0')).toMatchObject({ code: 'BAD_REQUEST' });
    expect(parseUpcoming(T0, '1.5')).toMatchObject({ code: 'BAD_REQUEST' });
    expect(parseUpcoming(T0, String(24 * 60))).toMatchObject({ ok: true });
    expect(parseUpcoming(T0, String(24 * 60 + 1))).toMatchObject({ code: 'RANGE_TOO_WIDE' });
  });
});

import { daysBetween, daysInMonth, lastCompleteMonth, monthsBetween, nextMonth } from '../../src/backfill/calendar-range';

/** IB-012 — the grids the backfill walks. All UTC; the archive's file names are the contract. */

describe('month grid', () => {
  it('walks months inclusively, across a year boundary', () => {
    expect(monthsBetween('2021-11', '2022-02')).toEqual(['2021-11', '2021-12', '2022-01', '2022-02']);
    expect(monthsBetween('2022-01', '2022-01')).toEqual(['2022-01']);
    expect(monthsBetween('2022-03', '2022-01')).toEqual([]);
  });

  it('nextMonth rolls December into January', () => {
    expect(nextMonth('2021-12')).toBe('2022-01');
  });

  it('rejects a malformed month rather than iterating forever', () => {
    expect(() => monthsBetween('2021-1', '2021-02')).toThrow();
  });

  it('the CURRENT month has no monthly archive file, so the last complete one is the month before', () => {
    expect(lastCompleteMonth(new Date('2026-09-28T12:00:00Z'))).toBe('2026-08');
    expect(lastCompleteMonth(new Date('2026-01-03T00:00:00Z'))).toBe('2025-12');
  });
});

describe('day grid', () => {
  it('knows February in a leap year and a normal one', () => {
    expect(daysInMonth('2024-02')).toHaveLength(29);
    expect(daysInMonth('2023-02')).toHaveLength(28);
    expect(daysInMonth('2026-09')).toHaveLength(30);
  });

  it('daysBetween is inclusive and crosses a month end', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });
});

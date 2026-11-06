import type { WebCandle } from '@trade-automation/contracts';
import {
  isoWeekStart, levelsInForce, monthOpens, monthStart, nextMonthStart, previousMonthLevels, weekOpens,
} from '../src/prior-levels';

/** IB-126 (design P1, P2): the month levels and the opens — complete periods only, UTC, ISO weeks. */
const DAY = 86_400;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;
const bar = (time: number, high: number, low: number, open = low): WebCandle => ({ time, open, high, low, close: high, volume: 1 });
/** Daily candles from `from` (inclusive) for `n` days, with high = 100 + i, low = 50 − i, open = 70 + i. */
const days = (from: number, n: number) => Array.from({ length: n }, (_, i) => bar(from + i * DAY, 100 + i, 50 - i, 70 + i));

describe('monthStart / nextMonthStart', () => {
  it('are the 1st 00:00 UTC, across a year end and a leap February', () => {
    expect(monthStart(utc(2026, 11, 30) + 86_399)).toBe(utc(2026, 11, 1));
    expect(nextMonthStart(utc(2026, 12, 31))).toBe(utc(2027, 1, 1));
    expect(nextMonthStart(utc(2028, 2, 10)) - utc(2028, 2, 1)).toBe(29 * DAY);
    expect(monthStart(utc(2027, 1, 1) - 1)).toBe(utc(2026, 12, 1));
  });
});

describe('previousMonthLevels', () => {
  it('draws each month at the previous calendar month\'s extremes', () => {
    const out = previousMonthLevels(days(utc(2026, 10, 1), 31));
    expect(out).toEqual([{ start: utc(2026, 11, 1), end: utc(2026, 12, 1), high: 130, low: 20 }]);
  });

  it('skips an incomplete month (one day missing) rather than drawing a partial month', () => {
    const oct = days(utc(2026, 10, 1), 31).filter((_, i) => i !== 15);
    expect(previousMonthLevels(oct)).toEqual([]);
    expect(previousMonthLevels(days(utc(2026, 10, 2), 30))).toEqual([]);
  });

  it('a 28-day February is complete with 28 candles; December rolls into January', () => {
    expect(previousMonthLevels(days(utc(2027, 2, 1), 28))).toEqual([{ start: utc(2027, 3, 1), end: utc(2027, 4, 1), high: 127, low: 23 }]);
    expect(previousMonthLevels(days(utc(2026, 12, 1), 31))[0]).toMatchObject({ start: utc(2027, 1, 1), end: utc(2027, 2, 1) });
  });
});

describe('weekOpens / monthOpens', () => {
  it('a week\'s open is its Monday candle\'s open; no Monday candle, no open', () => {
    const mon = utc(2026, 10, 12);
    expect(isoWeekStart(mon)).toBe(mon);
    expect(weekOpens(days(mon, 8))).toEqual([{ start: mon, end: mon + 7 * DAY, open: 70 }, { start: mon + 7 * DAY, end: mon + 14 * DAY, open: 77 }]);
    expect(weekOpens(days(mon + DAY, 6))).toEqual([]);
  });

  it('a month\'s open is its 1st\'s candle open, across the year end', () => {
    expect(monthOpens(days(utc(2026, 12, 30), 3))).toEqual([{ start: utc(2027, 1, 1), end: utc(2027, 2, 1), open: 72 }]);
    expect(monthOpens(days(utc(2026, 12, 2), 3))).toEqual([]);
  });

  it('ISO week at the year end: 2027-01-01 is a Friday, its week opened Monday 2026-12-28', () => {
    expect(isoWeekStart(utc(2027, 1, 1))).toBe(utc(2026, 12, 28));
    expect(weekOpens(days(utc(2026, 12, 28), 7))[0]).toEqual({ start: utc(2026, 12, 28), end: utc(2027, 1, 4), open: 70 });
  });
});

describe('levelsInForce', () => {
  // 2026-09-28 (Mon) … 2026-11-11: September is incomplete (3 days), October complete, the week of 10-26 complete
  const daily = days(utc(2026, 9, 28), 45);
  const at = utc(2026, 11, 4) + 15 * 3_600; // Wednesday 2026-11-04 15:00

  it('names every level with its period, from complete periods only', () => {
    const out = levelsInForce(daily, at);
    const by = Object.fromEntries(out.map((l) => [l.kind, l]));
    expect(out.map((l) => l.kind)).toEqual(['PDH', 'PDL', 'PWH', 'PWL', 'PMH', 'PML', 'WO', 'MO']);
    const i = (t: number) => (t - utc(2026, 9, 28)) / DAY; // a candle's index
    expect(by.PDH).toEqual({ kind: 'PDH', price: 100 + i(utc(2026, 11, 3)), start: utc(2026, 11, 4), end: utc(2026, 11, 5) });
    expect(by.PWH).toEqual({ kind: 'PWH', price: 100 + i(utc(2026, 11, 1)), start: utc(2026, 11, 2), end: utc(2026, 11, 9) });
    expect(by.PWL.price).toBe(50 - i(utc(2026, 11, 1)));
    expect(by.PMH).toEqual({ kind: 'PMH', price: 100 + i(utc(2026, 10, 31)), start: utc(2026, 11, 1), end: utc(2026, 12, 1) });
    expect(by.PML.price).toBe(50 - i(utc(2026, 10, 31)));
    expect(by.WO).toEqual({ kind: 'WO', price: 70 + i(utc(2026, 11, 2)), start: utc(2026, 11, 2), end: utc(2026, 11, 9) });
    expect(by.MO).toEqual({ kind: 'MO', price: 70 + i(utc(2026, 11, 1)), start: utc(2026, 11, 1), end: utc(2026, 12, 1) });
  });

  it('in October the month levels are absent: September is incomplete on file', () => {
    const kinds = levelsInForce(daily, utc(2026, 10, 20)).map((l) => l.kind);
    expect(kinds).not.toContain('PMH');
    expect(kinds).not.toContain('PML');
    expect(kinds).toContain('MO');
  });

  it('a bar\'s period is the one it OPENS in: Sunday 23:45 still reads last week\'s levels', () => {
    const sun = utc(2026, 11, 8) + DAY - 900;
    expect(levelsInForce(daily, sun).find((l) => l.kind === 'PWH')?.start).toBe(utc(2026, 11, 2));
    expect(levelsInForce(daily, sun + 900).find((l) => l.kind === 'PWH')?.start).toBe(utc(2026, 11, 9));
  });
});

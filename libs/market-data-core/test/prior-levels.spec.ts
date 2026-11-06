import type { WebCandle } from '@trade-automation/contracts';
import { isoWeekStart, previousDayLevels, previousWeekLevels } from '../src/prior-levels';

const DAY = 86_400;
const MON = Date.UTC(2026, 9, 12) / 1000; // Monday 2026-10-12
const day = (time: number, high: number, low: number): WebCandle => ({ time, open: low, high, low, close: high, volume: 1 });

describe('isoWeekStart', () => {
  it('is the Monday 00:00 UTC of the week', () => {
    expect(isoWeekStart(MON)).toBe(MON);
    expect(isoWeekStart(MON + 6 * DAY + 86_399)).toBe(MON); // Sunday 23:59:59
    expect(isoWeekStart(MON + 7 * DAY)).toBe(MON + 7 * DAY);
    expect(isoWeekStart(MON - 1)).toBe(MON - 7 * DAY);
  });
});

describe('previousDayLevels', () => {
  it('draws each day at the previous day\'s high and low', () => {
    const levels = previousDayLevels([day(MON + DAY, 120, 90), day(MON, 110, 100)]);
    expect(levels).toEqual([
      { start: MON + DAY, end: MON + 2 * DAY, high: 110, low: 100 },
      { start: MON + 2 * DAY, end: MON + 3 * DAY, high: 120, low: 90 },
    ]);
  });
});

describe('previousWeekLevels', () => {
  const week = (start: number, highs: number[]) => highs.map((h, i) => day(start + i * DAY, h, h - 10));

  it('draws each week at the previous ISO week\'s extremes', () => {
    const levels = previousWeekLevels(week(MON, [1, 2, 7, 3, 4, 5, 6]));
    expect(levels).toEqual([{ start: MON + 7 * DAY, end: MON + 14 * DAY, high: 7, low: -9 }]);
  });

  it('skips an incomplete week rather than drawing a partial week\'s low as the week\'s', () => {
    expect(previousWeekLevels(week(MON, [1, 2, 3]))).toEqual([]);
  });
});

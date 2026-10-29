import type { WebCandle } from '@trade-automation/contracts';
import { isoWeekStart, levelSteps, previousDayLevels, previousWeekLevels } from './prior-levels';

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

describe('levelSteps', () => {
  const hourly = (from: number, hours: number) => Array.from({ length: hours }, (_, i) => from + 3_600 * i);
  const periods = [
    { start: MON, end: MON + DAY, high: 10, low: 1 },
    { start: MON + DAY, end: MON + 2 * DAY, high: 20, low: 2 },
  ];

  it('is a point on each period\'s first and last bar', () => {
    const times = hourly(MON, 48);
    expect(levelSteps(periods, times, 'high')).toEqual([
      { time: MON, value: 10 }, { time: MON + 23 * 3_600, value: 10 },
      { time: MON + DAY, value: 20 }, { time: MON + DAY + 23 * 3_600, value: 20 },
    ]);
  });

  it('every point is a candle time, so the time scale gets no extra slot', () => {
    const times = hourly(MON + 5 * 3_600, 30); // starts mid-day, ends mid-day
    for (const p of levelSteps(periods, times, 'low')) expect(times).toContain(p.time);
  });

  it('leaves a gap where a period has no level instead of carrying the last one on', () => {
    const times = hourly(MON, 72);
    const gappy = [periods[0], { start: MON + 2 * DAY, end: MON + 3 * DAY, high: 30, low: 3 }];
    const out = levelSteps(gappy, times, 'high');
    expect(out[2]).toEqual({ time: MON + DAY }); // whitespace: the chart draws nothing there
    expect(out[3]).toEqual({ time: MON + 2 * DAY, value: 30 });
  });

  it('a period with one bar (the 1d chart) is one point', () => {
    expect(levelSteps(periods, [MON, MON + DAY], 'high')).toEqual([{ time: MON, value: 10 }, { time: MON + DAY, value: 20 }]);
  });

  it('periods outside the candles draw nothing', () => {
    expect(levelSteps(periods, hourly(MON + 10 * DAY, 5), 'high')).toEqual([]);
  });
});

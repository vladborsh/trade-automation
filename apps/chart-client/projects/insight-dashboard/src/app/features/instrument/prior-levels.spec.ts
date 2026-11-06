import { levelSteps } from './prior-levels';

const DAY = 86_400;
const MON = Date.UTC(2026, 9, 12) / 1000; // Monday 2026-10-12

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

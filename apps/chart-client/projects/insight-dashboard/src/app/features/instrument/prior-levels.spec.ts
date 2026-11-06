import { levelLines, levelSteps } from './prior-levels';

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

describe('levelLines (IB-129)', () => {
  const D = 86_400;
  const OCT1 = Date.UTC(2026, 9, 1) / 1000;
  const NOV1 = Date.UTC(2026, 10, 1) / 1000;
  // every day of October 2026 and 1–6 November; October's high is on the 10th, its low on the 20th
  const daily = Array.from({ length: 37 }, (_, i) => {
    const time = OCT1 + i * D;
    return { time, open: 100 + i, high: i === 9 ? 500 : 200, low: i === 19 ? 10 : 50, close: 100 + i, volume: 1 };
  });
  const hours = Array.from({ length: 24 * 3 }, (_, i) => NOV1 + 3 * D + i * 3_600); // 4–6 Nov, 1h bars
  const titles = (off = {}, tf = '1h') => levelLines(daily as never, hours, tf, off).map((l) => l.title);

  it('draws PMH/PML from the previous COMPLETE month, and WO/MO at their periods\' opens', () => {
    const lines = levelLines(daily as never, hours, '1h');
    const at = (t: string) => lines.find((l) => l.title === t)!.points.map((p) => p.value);
    expect(at('PMH').every((v) => v === 500)).toBe(true);
    expect(at('PML').every((v) => v === 10)).toBe(true);
    expect(at('MO').every((v) => v === 100 + 31)).toBe(true); // 1 Nov's open
    expect(at('WO').every((v) => v === 100 + 32)).toBe(true); // Monday 2 Nov's open
    expect(titles()).toEqual(['PDH', 'PDL', 'PWH', 'PWL', 'PMH', 'PML', 'WO', 'MO']);
  });

  it('each switch takes its own lines out and nothing else; PDH…PWL have no switch', () => {
    expect(titles({ prevMonth: true })).toEqual(['PDH', 'PDL', 'PWH', 'PWL', 'WO', 'MO']);
    expect(titles({ weekOpen: true })).toEqual(['PDH', 'PDL', 'PWH', 'PWL', 'PMH', 'PML', 'MO']);
    expect(titles({ monthOpen: true, liqAlerts: true })).toEqual(['PDH', 'PDL', 'PWH', 'PWL', 'PMH', 'PML', 'WO']);
  });

  it('an incomplete previous month draws no PMH/PML (no level is better than a wrong one)', () => {
    const missingDay = daily.filter((d) => d.time !== OCT1 + 14 * D);
    expect(levelLines(missingDay as never, hours, '1h').map((l) => l.title)).not.toContain('PMH');
  });

  it('on 1w the day\'s pair is left out; the month and the opens stay; colours are distinct from the day/week pairs', () => {
    const weekly = [NOV1 + D]; // Monday 2 Nov, a 1w bar
    expect(levelLines(daily as never, weekly, '1w').map((l) => l.title)).not.toContain('PDH');
    const lines = levelLines(daily as never, hours, '1h');
    const colour = (t: string) => lines.find((l) => l.title === t)!.colour;
    expect(new Set([colour('PDH'), colour('PWH'), colour('PMH'), colour('WO')]).size).toBe(4);
    expect(lines.find((l) => l.title === 'WO')!.dash).not.toBe(lines.find((l) => l.title === 'MO')!.dash);
  });
});

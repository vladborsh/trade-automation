import { daySeparatorTimes, showsDaySeparators } from './day-separators';

const DAY = 86_400;
const D0 = Date.UTC(2026, 9, 20) / 1000; // a UTC midnight

describe('daySeparatorTimes', () => {
  it('puts one line on each UTC midnight bar after the first day', () => {
    const hourly = Array.from({ length: 72 }, (_, i) => D0 + 3_600 * i);
    expect(daySeparatorTimes(hourly)).toEqual([D0 + DAY, D0 + 2 * DAY]);
  });

  it('starting mid-day, the first midnight still gets its line', () => {
    const times = [D0 + 20 * 3_600, D0 + 23 * 3_600, D0 + DAY, D0 + DAY + 3_600];
    expect(daySeparatorTimes(times)).toEqual([D0 + DAY]);
  });

  it('a missing midnight bar moves the line to that day\'s first bar, on the candle grid', () => {
    const times = [D0, D0 + 3_600, D0 + DAY + 7_200, D0 + DAY + 10_800];
    expect(daySeparatorTimes(times)).toEqual([D0 + DAY + 7_200]);
  });

  it('a whole day missing draws no line for it', () => {
    expect(daySeparatorTimes([D0, D0 + 2 * DAY])).toEqual([D0 + 2 * DAY]);
  });

  it('is empty without candles or within a single day', () => {
    expect(daySeparatorTimes([])).toEqual([]);
    expect(daySeparatorTimes([D0, D0 + 60])).toEqual([]);
  });
});

describe('showsDaySeparators', () => {
  it('up to 4h, not on 1d', () => {
    for (const tf of ['1m', '15m', '1h', '4h']) expect(showsDaySeparators(tf)).toBe(true);
    expect(showsDaySeparators('1d')).toBe(false);
  });

  it('IB-065: on 3m and 5m, not on 1w', () => {
    expect(showsDaySeparators('3m') && showsDaySeparators('5m')).toBe(true);
    expect(showsDaySeparators('1w')).toBe(false);
  });
});

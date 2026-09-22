import { mergeTimes, oldestLoadedMs } from './chart-time';

describe('mergeTimes (T-056)', () => {
  it('two ascending lists as one ascending list — the bars and their padding', () => {
    expect(mergeTimes([0, 300, 1200], [600, 900, 1500])).toEqual([0, 300, 600, 900, 1200, 1500]);
    expect(mergeTimes([0, 300], [])).toEqual([0, 300]);
    expect(mergeTimes([], [600])).toEqual([600]);
  });
});

describe('oldestLoadedMs', () => {
  it('the first candle\'s open, or the first metric point\'s time; null with nothing loaded', () => {
    expect(oldestLoadedMs('candles', [{ openTime: 5 }, { openTime: 9 }], [])).toBe(5);
    expect(oldestLoadedMs('metric', [], [{ time: 7 }])).toBe(7);
    expect(oldestLoadedMs('candles', [], [{ time: 7 }])).toBeNull();
  });
});

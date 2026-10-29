import { barSeconds, barsWithin, snapTime, snapToGrid } from './time-grid';

describe('time grid', () => {
  it('knows the page timeframes and falls back to a minute', () => {
    expect(barSeconds('1h')).toBe(3_600);
    expect(barSeconds('4h')).toBe(14_400);
    expect(barSeconds('nope')).toBe(60);
  });

  it('snaps to the start of the bar', () => {
    expect(snapTime(3_600 + 299, 3_600)).toBe(3_600);
    expect(snapTime(7_199, 3_600)).toBe(3_600);
  });

  it('twelve 5-minute readings in an hour become one point, the last one', () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ time: 3_600 + i * 300, value: i }));
    expect(snapToGrid(points, 3_600)).toEqual([{ time: 3_600, value: 11 }]);
  });

  it('keeps the last reading by time even when the input is out of order', () => {
    const out = snapToGrid([{ time: 3_900, value: 2 }, { time: 7_300, value: 3 }, { time: 3_700, value: 1 }], 3_600);
    expect(out).toEqual([{ time: 3_600, value: 2 }, { time: 7_200, value: 3 }]);
  });

  it('leaves points already on a finer grid alone', () => {
    const points = [{ time: 300, value: 1 }, { time: 600, value: 2 }];
    expect(snapToGrid(points, 60)).toEqual(points);
  });
});

describe('barsWithin', () => {
  const times = [60, 120, 180, 300];

  it('is the first and last bar starting inside [from, to)', () => {
    expect(barsWithin(times, 100, 300)).toEqual({ first: 120, last: 180 });
    expect(barsWithin(times, 60, 61)).toEqual({ first: 60, last: 60 });
  });

  it('excludes a bar starting exactly at the end', () => {
    expect(barsWithin(times, 0, 120)).toEqual({ first: 60, last: 60 });
  });

  it('is null when no bar starts inside, including a hole in the candles', () => {
    expect(barsWithin(times, 200, 300)).toBeNull();
    expect(barsWithin(times, 400, 500)).toBeNull();
    expect(barsWithin([], 0, 100)).toBeNull();
  });
});

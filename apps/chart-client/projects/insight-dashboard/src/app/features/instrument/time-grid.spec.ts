import { BINANCE_KLINES_1W } from './binance-klines-1w.fixture';
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

describe('IB-065: 3m, 5m and the Monday week', () => {
  const WEEK = 604_800;

  it('knows the new frames', () => {
    expect(barSeconds('3m')).toBe(180);
    expect(barSeconds('5m')).toBe(300);
    expect(barSeconds('1w')).toBe(WEEK);
  });

  it('a real weekly candle opens on its own grid point, a Monday', () => {
    for (const k of BINANCE_KLINES_1W) {
      const open = k[0] / 1000;
      expect(new Date(k[0]).getUTCDay()).toBe(1);
      expect(snapTime(open, WEEK)).toBe(open);
      // any moment inside that week, Sunday 23:59:59 included, belongs to it
      expect(snapTime((k[6] + 1) / 1000 - 1, WEEK)).toBe(open);
      expect(snapTime(open + 3 * 86_400 + 1234, WEEK)).toBe(open);
    }
  });

  it('the epoch grid alone would have put the week on a Thursday — the bug the offset prevents', () => {
    const open = BINANCE_KLINES_1W[0][0] / 1000;
    expect(new Date(Math.floor(open / WEEK) * WEEK * 1000).getUTCDay()).toBe(4);
  });

  it('a reading on a weekly chart lands on the candle\'s Monday slot', () => {
    const open = BINANCE_KLINES_1W[1][0] / 1000;
    const points = [{ time: open + 86_400, value: 1 }, { time: open + 5 * 86_400, value: 2 }];
    expect(snapToGrid(points, WEEK)).toEqual([{ time: open, value: 2 }]);
  });

  it('3m and 5m keep the epoch grid', () => {
    const t = Date.UTC(2026, 9, 29, 14, 37, 12) / 1000;
    expect(snapTime(t, 180)).toBe(Date.UTC(2026, 9, 29, 14, 36) / 1000);
    expect(snapTime(t, 300)).toBe(Date.UTC(2026, 9, 29, 14, 35) / 1000);
  });
});

import type { LogicalRange } from 'lightweight-charts';
import { shiftedView, unionTimes } from './time-axis-strip';

const range = (from: number, to: number) => ({ from, to }) as LogicalRange;

describe('shiftedView', () => {
  it('shifts by the number of slots prepended before the old first one', () => {
    // the reader was 30 bars into empty space on the left; 100 earlier bars arrive
    const times = [...Array.from({ length: 100 }, (_, i) => i * 60), 6_000, 6_060];
    expect(shiftedView(range(-30, 50), 6_000, times)).toEqual(range(70, 150));
  });

  it('keeps the view when nothing was prepended', () => {
    expect(shiftedView(range(-5, 20), 0, [0, 60, 120])).toEqual(range(-5, 20));
  });
});


describe('unionTimes', () => {
  it('every distinct time across the series, ascending', () => {
    const out = unionTimes([
      [{ time: 300 }, { time: 60 }],
      [{ time: 60 }, { time: 120 }],
      [],
    ]);
    expect(out).toEqual([60, 120, 300]);
  });

  it('nothing in, nothing out', () => {
    expect(unionTimes([])).toEqual([]);
  });
});

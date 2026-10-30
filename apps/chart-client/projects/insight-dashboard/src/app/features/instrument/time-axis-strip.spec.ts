import { unionTimes } from './time-axis-strip';

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
